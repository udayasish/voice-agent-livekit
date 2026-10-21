import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createClinicServices, type ClinicDependencies, type ClinicServices, type AppointmentSummary } from "../index.js";
import { bookingInputSchema, dateSchema } from "../contracts/inputs.js";
import { appointmentSummarySchema, cancellationSchema, doctorMatchSchema, doctorSummarySchema, slotSummarySchema, upcomingSummarySchema } from "../contracts/results.js";
import { defineTool, ToolRegistry, toolFailure, type ToolContext, type ToolResult } from "../../agent/tools/index.js";
import { normalizePhoneNumber, formatPhoneNumberForSpeech } from "../../agent/normalizers/index.js";
import type { AgentLanguage, BusinessBehavior, SessionContext, TurnPreparationContext } from "../../agent/engine/index.js";
import { normalizeDoctorName, containsCompletionClaim } from "./confirmation.js";
import { unclearDecision, type ConfirmationInterpreter } from "./interpreter.js";
import { ClinicDialogue, readStateSchema, doctorResultSchema, type VoiceDoctor } from "./dialogue.js";
import { doctorName } from "../doctor-names.js";
import { clinicLocalDate } from "../timezone.js";
import { calendarDate, spokenDate, spokenTime, hasUnverifiedNumericDate } from "./calendar.js";
import { conciseClinicSpeech } from "./speech-style.js";
import { asciiNumberText } from "./spoken-numbers.js";
import type { TurnOptions } from "../../agent/engine/index.js";
import { applyIntakeDecision, emptyIntake, intakeStateSchema, nextIntakeField, retainIntakeEvidence, validateIntakeDecision, type IntakeInterpreter, type IntakeInput } from "./intake.js";
import { clinicReadModelSchema, projectClinicRead, readOffset } from "./model-results.js";

export const clinicVoiceStateSchema = z.object({
  intake: intakeStateSchema,
  contextBoundary: z.number().int().nonnegative(),
  slots: z.object({ doctor: z.string().optional(), dateOrTime: z.string().optional(), patientName: z.string().optional(), phoneNumber: z.string().optional() }).strict(),
  phoneConfirmed: z.boolean(), collectingPhone: z.boolean(), patientId: z.string().nullable(),
  pendingDraftId: z.string().nullable(), authorizedAppointments: z.array(z.string()),
  dialogue: readStateSchema,
  lastReadFailure: z.object({ toolName: z.string(), code: z.string(), turnId: z.number().int(), date: dateSchema.nullable() }).strict().nullable(),
  phoneCandidates: z.array(z.object({ id: z.uuid(), digits: z.string().regex(/^\d{10}$/u) }).strict()).max(5),
  activeCandidateId: z.uuid().nullable(), previousCandidateId: z.uuid().nullable(), phoneReadbackTurn: z.number().int().nullable(), phoneReadbackCompleted: z.boolean(),
  pendingAction: z.object({ id: z.uuid(), kind: z.enum(["booking", "cancellation"]), readback: z.string(),
    readbackTurn: z.number().int().nullable(), completedPlayback: z.boolean(), authorizedTurn: z.number().int().nullable() }).strict().nullable(),
  completedActions: z.array(z.object({ id: z.uuid(), turnId: z.number().int(), kind: z.enum(["booking", "cancellation"]),
    result: z.union([appointmentSummarySchema, cancellationSchema]) }).strict()),
}).strict();
export type ClinicVoiceState = z.infer<typeof clinicVoiceStateSchema>;
type Upcoming = z.infer<typeof upcomingSummarySchema>;
type Slot = z.infer<typeof slotSummarySchema>;
type Draft = { id: string; readbackTurn?: number; heard: boolean; authorizedTurn?: number | undefined; completed?: boolean } &
  ({ kind: "booking"; input: z.infer<typeof bookingInputSchema>; slot: Slot; doctorName: string; timezone: string; result?: AppointmentSummary }
  | { kind: "cancellation"; appointment: Upcoming; reason: string; result?: z.infer<typeof cancellationSchema> });
const ok = <T>(data: T): ToolResult<T> => ({ success: true, data });
const failure = (code: string, message: string) => toolFailure(code, message);
const empty = z.object({}).strict();
const clinicInfoSchema = z.object({ name: z.string(), timezone: z.string(), localDate: dateSchema, localTime: z.string() }).strict();
const resolverOutput = z.object({ clinic: clinicInfoSchema, callerResolved: z.boolean(), phoneNeedsConfirmation: z.boolean() }).strict();
const bookingOutput = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("confirmation_required"), draftId: z.uuid() }).strict(),
  z.object({ outcome: z.literal("booked"), appointment: appointmentSummarySchema }).strict(),
  z.object({ outcome: z.literal("unavailable"), dates: z.array(dateSchema), times: z.array(slotSummarySchema), timezone: z.string() }).strict(),
]);
const cancellationOutput = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("confirmation_required"), draftId: z.uuid() }).strict(),
  z.object({ outcome: z.literal("cancelled"), cancellation: cancellationSchema }).strict(),
]);

/** A clinic-specific adapter; the generic engine/executor never import these services. */
export class ClinicVoiceRuntime {
  readonly registry: ToolRegistry;
  readonly behavior: BusinessBehavior<ClinicVoiceState>;
  private turn = 0;
  private closed = false;
  private phone = "";
  private candidates: { id: string; digits: string }[] = [];
  private activeCandidateId: string | null = null;
  private previousCandidateId: string | null = null;
  private readonly completedActions: ClinicVoiceState["completedActions"] = [];
  private prepared = false;
  private actionReadback = "";
  private phoneText = "";
  private phoneHeard = false;
  private phoneReadbackTurn: number | undefined;
  private phoneConfirmed = false;
  private collectingPhone = false;
  private patientId: string | undefined;
  private draft: Draft | undefined;
  private failures = 0;
  private slots: ClinicVoiceState["slots"] = {};
  private intake = emptyIntake();
  private boundary = 0;
  private replySource: "model" | "verified_tool" | "recovery" = "verified_tool";
  private readonly grants = new Map<string, Upcoming>();
  private readonly doctors = new Map<string, string>();
  private readonly offered = new Map<string, { doctorId: string; slot: Slot }>();
  private reply: { turnId: number; text: (language: AgentLanguage) => string; readback?: "phone" | "action" } | undefined;
  private mutations: Promise<unknown> = Promise.resolve();
  private readonly service: ClinicServices;
  private lastReadFailure: ClinicVoiceState["lastReadFailure"] = null;
  readonly dialogue: ClinicDialogue;
  private plannedProblem: "disabled" | "doctor" | "date" | "time" | "ampm" | undefined;
  private language: AgentLanguage = "as";
  private actionCorrection = false;
  private replyGoal: NonNullable<ClinicVoiceState["intake"]["lastQuestion"]>["field"] | undefined;
  constructor(readonly context: SessionContext, readonly callId: string, readonly conversationId: string, private readonly deps: ClinicDependencies, timezone = "Asia/Kolkata", private readonly interpret: ConfirmationInterpreter = async () => unclearDecision(), private readonly interpretIntake?: IntakeInterpreter, private readonly enabledTools?: readonly string[]) {
    this.dialogue = new ClinicDialogue(timezone);
    this.service = this.services();
    this.registry = this.makeRegistry();
    this.behavior = {
      allowRepeatedResponses: true,
      stateSchema: clinicVoiceStateSchema, initialState: () => this.snapshot(),
      onTurn: async (text, turnId, preparation = { turnId, signal: new AbortController().signal, language: this.language, history: [] }) => {
        this.language = preparation.language;
        let intakeFailure = false;
        const explicitName = /\bname\b|নাম|नाम/iu.test(text);
        const explicitAge = /\bage\b|\byears?\b|বয়স|বয়স|বছৰ|এইজ|এজ|उम्र|साल/iu.test(text);
        const explicitIntake = explicitName || explicitAge;
        // A missing phone does not prevent the caller correcting another field.
        if (this.collectingPhone && !this.phone && explicitIntake) this.collectingPhone = false;
        const confirmationTurn = this.collectingPhone || Boolean(this.phone && !this.phoneConfirmed) || Boolean(this.draft && !this.draft.completed);
        let planned = this.enabledTools ? this.planTurn(text, this.enabledTools,
          explicitIntake || ["name", "age"].includes(this.intake.lastQuestion?.field ?? "")) : undefined;
        const phoneWasConfirmed = this.phoneConfirmed;
        await this.accept(text, turnId, preparation);
        preparation.signal.throwIfAborted();
        if (this.closed || this.turn !== turnId) throw new DOMException("Turn superseded", "AbortError");
        if (!phoneWasConfirmed && this.phoneConfirmed) {
          // Confirmation is already server validated. Bind from that state,
          // without asking the model to reconstruct/resubmit the phone number.
          if (this.intake.lastQuestion?.field === "phone") this.intake.lastQuestion = null;
          if (!planned && !this.draft && this.enabledTools?.includes("resolve_clinic_and_caller")) {
            planned = { name: "resolve_clinic_and_caller", arguments: {} };
          }
        }
        const missingIntake = nextIntakeField(this.intake, this.phoneConfirmed) !== "ready" || this.intake.unresolved;
        const correctionHint = Boolean(this.intake.age) && /\b(?:no|not|wrong|correct)\b|নহয়|নহয়|ভুল|नहीं|गलत/iu.test(text);
        const expectedIntake = missingIntake && (this.dialogue.state.question === "patient" || ["name", "age"].includes(this.intake.lastQuestion?.field ?? "") || this.intake.unresolved);
        const optionAnswer = !planned && !this.plannedProblem && ["date", "time", "ampm"].includes(this.dialogue.state.question)
          && Boolean(this.dialogue.state.offeredDates.length || this.dialogue.state.offeredSlots.length)
          && text.trim().split(/\s+/u).length <= 8
          && !/[?？]|\b(?:why|what|which|how|booking|appointment|book|cancel|available)\b|কিয়|কোন|কিমান|এপইণ্ট|বুক|বাতিল/iu.test(text);
        if (this.interpretIntake && (!confirmationTurn || this.actionCorrection) && (!this.prepared || this.actionCorrection)
          && (explicitIntake || correctionHint || expectedIntake || optionAnswer || this.actionCorrection || (missingIntake && this.intake.pending.length > 0)) && (!planned || explicitIntake)) {
          if (this.actionCorrection) { this.reply = undefined; this.prepared = false; }
          const revision = this.intake.revision;
          const selectionOnly = optionAnswer && !explicitIntake && !expectedIntake;
          let expectedField: IntakeInput["expectedField"] = this.conversationGoal();
          if (selectionOnly) expectedField = this.dialogue.state.question === "ampm" ? "ampm" : this.dialogue.state.question === "date" ? "date" : "time";
          else if (explicitName) expectedField = "name";
          else if (explicitAge) expectedField = "age";
          const input: IntakeInput = { text, turnId, language: this.language, expectedField, state: structuredClone(this.intake), phoneConfirmed: this.phoneConfirmed,
            history: preparation.history.slice(-4), selection: { doctor: this.dialogue.state.selectedDoctor ? doctorName(this.dialogue.state.selectedDoctor, this.language) : null,
              date: this.dialogue.state.selectedDate, time: this.dialogue.state.offeredSlots.find(s => s.id === this.dialogue.state.selectedSlotId)?.startTime ?? null },
            offered: { dates: this.dialogue.state.offeredDates, times: this.dialogue.state.offeredSlots.slice(0, 8).map(s => ({ id: s.id, time: s.startTime.slice(0, 5) })) } };
          let decision;
          try {
            const proposal = await this.interpretIntake(input, preparation.signal); decision = proposal ? validateIntakeDecision(proposal, input) : null;
            if (selectionOnly && decision && (decision.name || decision.age || decision.disputedFields.length)) throw new Error("Selection cannot change patient fields");
          }
          catch { preparation.signal.throwIfAborted(); decision = null; }
          preparation.signal.throwIfAborted();
          if (this.closed || this.turn !== turnId || revision !== this.intake.revision) throw new DOMException("Turn superseded", "AbortError");
          if (decision) {
            const applied = selectionOnly ? { changed: false, progress: false } : applyIntakeDecision(this.intake, decision, input);
            if (this.intake.name) this.slots.patientName = this.intake.name.value;
            if (applied.changed && this.draft && !this.draft.completed) this.draft = undefined;
            let choiceAccepted = false;
            if (decision.choice) {
              choiceAccepted = this.dialogue.choose(decision.choice.date, decision.choice.slotId);
              if (choiceAccepted) {
                if (this.draft && !this.draft.completed) this.draft = undefined;
                this.syncSelection();
                if (this.dialogue.state.selectedDoctor && !decision.choice.slotId && this.enabledTools) {
                  if (this.enabledTools.includes("get_available_times")) planned = { name: "get_available_times", arguments: { date: this.dialogue.state.selectedDate } };
                  else this.plannedProblem = "disabled";
                }
              } else { this.plannedProblem = this.dialogue.state.selectedDate ? "ampm" : "date"; }
            }
            const intakeNext = nextIntakeField(this.intake, this.phoneConfirmed);
            const next = selectionOnly && !choiceAccepted ? this.dialogue.state.question === "date" ? "date" : "time"
              : intakeNext === "ready" ? this.conversationGoal() : intakeNext;
            this.deps.logger.info("Clinic understanding completed", { organizationId: this.context.organizationId, sessionId: this.context.sessionId, turnId,
              outcome: choiceAccepted ? "selection" : applied.progress ? "captured" : this.intake.unresolved ? "clarification" : "no_progress",
              hasName: Boolean(this.intake.name), hasAge: Boolean(this.intake.age), disputedName: this.intake.unresolvedName,
              disputedAge: this.intake.unresolvedAge, nonProgress: this.intake.nonProgress, nextField: this.conversationGoal() });
            if (!planned && !this.plannedProblem && !containsCompletionClaim(decision.reply)
              && ((decision.intent !== "other" && decision.nextField === next) || (choiceAccepted && decision.nextField === this.conversationGoal()))) {
              if (next !== "ready" || !this.enabledTools?.includes("book_appointment")) {
                if (!applied.progress && this.intake.nonProgress >= 2 && !choiceAccepted) this.say(lang => this.intakeClarification(lang, next));
                else { this.say(() => decision.reply); this.replySource = "model"; }
                this.replyGoal = choiceAccepted ? this.conversationGoal() : next; this.prepared = true;
              }
              if (next === "phone" && !choiceAccepted) this.collectingPhone = true;
            }
          } else {
            retainIntakeEvidence(this.intake, input);
            // A failed correction interpretation cannot leave a previous value
            // silently eligible for booking. A later explicit correction resolves it.
            if (this.intake.age && (/\bage\b|বয়স|বয়স|উম্র|उम्र/iu.test(text) || input.state.lastQuestion?.field === "age")) this.intake.unresolvedAge = true;
            if (this.intake.name && (/\bname\b|নাম|नाम/iu.test(text) || input.state.lastQuestion?.field === "name")) this.intake.unresolvedName = true;
            this.intake.unresolved = this.intake.unresolvedAge || this.intake.unresolvedName;
            this.intake.revision++;
            this.say(lang => ({ as: "উত্তৰ প্ৰক্ৰিয়াকৰণত সমস্যা হৈছে। অলপ পিছত চেষ্টা কৰক।", hi: "जवाब तैयार करने में समस्या है। कृपया थोड़ी देर बाद कोशिश करें।", en: "Response processing failed. Please try again shortly." })[lang]);
            this.prepared = true; this.replySource = "recovery"; intakeFailure = true;
          }
        }
        if (this.plannedProblem === "disabled") this.dialogue.problem(turnId, "disabled");
        const guidance = this.plannedProblem;
        this.plannedProblem = undefined;
        if (intakeFailure) return { failureCategory: "interpretation_failed" };
        if (planned) return { initialToolCall: planned, allowedTools: [planned.name] };
        if (guidance) return { allowedTools: [] };
        if (this.enabledTools && this.draft && !this.draft.completed) return { allowedTools: this.enabledTools.filter(name => name === (this.draft!.kind === "booking" ? "book_appointment" : "cancel_appointment")) };
        return this.enabledTools ? { allowedTools: this.turnTools().filter(name => this.enabledTools!.includes(name)
          && !(name === "resolve_clinic_and_caller" && this.phoneConfirmed && this.patientId)) } : undefined;
      }, update: () => this.snapshot(),
      contextBoundary: () => this.boundary,
      // Public read events already live in validated selection state. Summarizing
      // them spends foreground quota without adding conversational memory.
      memoryInput: () => [],
      preparedReply: language => this.prepared && this.reply?.turnId === this.turn ? { text: this.reply.text(language), source: this.replySource } : undefined,
      onRecovery: (reason, turnId) => {
        this.turn = turnId; this.prepared = true; this.reply = undefined;
        if (this.draft && !this.draft.completed) this.readback(this.draft);
        else if (this.phone && !this.phoneConfirmed) this.clarifyPhone();
        else this.say(lang => ({ as: reason === "no_input" ? "মই শুনি আছোঁ। আপুনি কি কৰিব বিচাৰে?" : "আপোনাৰ কথা স্পষ্ট নহ'ল। অনুগ্ৰহ কৰি আকৌ এবাৰ কওক।",
          hi: "मैं सुन रही हूँ। कृपया अपनी बात फिर से कहें।", en: reason === "no_input" ? "I'm listening. How can I help?" : "Your speech was unclear. Please say that again." })[lang]);
      },
      onPlaybackResult: (turnId, completed) => {
        if (this.phoneReadbackTurn === turnId) this.phoneHeard = completed;
        if (this.draft?.readbackTurn === turnId) this.draft.heard = completed;
      },
      promptContext: () => JSON.stringify({ name: this.intake.name?.value ?? this.slots.patientName ?? null, age: this.intake.age?.value ?? null,
        disputedName: this.intake.unresolvedName, disputedAge: this.intake.unresolvedAge,
        unresolved: this.intake.unresolved, phoneConfirmed: this.phoneConfirmed, expectedField: this.conversationGoal(),
        lastQuestion: this.intake.lastQuestion?.field ?? null, nonProgress: this.intake.nonProgress }),
      verifiedContext: () => JSON.stringify({ selectedDoctor: this.dialogue.state.selectedDoctor ? { id: this.dialogue.state.selectedDoctor.id,
        name: doctorName(this.dialogue.state.selectedDoctor, this.language) } : null, selectedDate: this.dialogue.state.selectedDate,
        selectedSlot: this.dialogue.state.offeredSlots.find(s => s.id === this.dialogue.state.selectedSlotId) ? {
          id: this.dialogue.state.selectedSlotId, time: this.dialogue.state.offeredSlots.find(s => s.id === this.dialogue.state.selectedSlotId)!.startTime.slice(0, 5) } : null,
        offeredDates: this.dialogue.state.offeredDates, lastReadFailure: this.lastReadFailure,
        phoneCaptured: Boolean(this.phone), phoneConfirmed: this.phoneConfirmed, callerResolved: Boolean(this.patientId),
        ...(this.completedSummary() && (!this.draft || this.draft.completed) ? {
          conversationPhase: "completed",
          completionGuidance: "Action finished. Answer naturally from latestCompletedAction; no intake or reconfirmation. Caller may end the call; never auto-disconnect.",
        } : {}),
        nextField: this.completedSummary() && (!this.draft || this.draft.completed) ? "none" : this.conversationGoal(),
        bookingState: this.callerActions().at(-1)?.kind === "booking" ? "booked_in_session" : this.callerActions().at(-1)?.kind === "cancellation"
          ? "cancelled_in_session" : this.draft?.completed ? "reconcile_required" : "not_booked_for_current_caller",
        latestCompletedAction: this.completedSummary(),
        timezone: this.dialogue.timezone,
        localDate: clinicLocalDate(this.deps.now?.() ?? new Date(), this.dialogue.timezone), pendingAction: this.draft && !this.draft.completed ? {
          id: this.draft.id, kind: this.draft.kind, completed: Boolean(this.draft.completed),
          readbackCompleted: this.draft.heard, authorizedForCurrentTurn: this.draft.authorizedTurn === this.turn,
          readback: this.actionReadback,
        } : null }),
      respond: input => {
        this.language = input.language;
        if (this.reply?.turnId === this.turn) {
          const text = this.reply.text(input.language);
          if (this.replySource !== "model") return { text, source: this.replySource };
          return this.ordinarySpeech(text, input.language, this.replyGoal ?? this.conversationGoal());
        }
        const read = this.dialogue.state.latest;
        if (read?.turnId !== this.turn) {
          const completed = this.completedSpeech(input.text, input.language, input.isFallback ? "recovery" : "model");
          if (completed) return completed;
        }
        if (this.lastReadFailure && (input.isFallback || /নতুন.*(?:পুৰণি|বাতিল)|new.*(?:or.*cancel|old appointment)|which.*doctor|কোনজন.*(?:চিকিৎসক|ডাক্তৰ|ডক্টৰ)/iu.test(input.text))) {
          return { text: this.readFailureReply(input.language), source: "verified_tool" };
        }
        if (read?.turnId === this.turn && read.outcome === "service_error") {
          const name = this.dialogue.state.selectedDoctor;
          const grounded = (!name || [name.name, name.nameEn, name.nameAs].some(n => n && input.text.includes(n.replace(/\s*\(Voice Test\)/u, ""))))
            && /failed|could not|unable|পৰা নাই|সমস্যা|ব্যৰ্থ|नहीं|समस्या/iu.test(input.text);
          return grounded ? { text: input.text, source: "model" } : { text: this.readFailureReply(input.language), source: "verified_tool" };
        }
        if (input.isFallback && read?.turnId !== this.turn && this.dialogue.state.selectedDoctor && !this.callerActions().length && !this.draft?.completed) {
          return { text: ({ as: "উত্তৰ দিয়া সেৱাত সমস্যা হৈছে। বাছনি ৰাখিছোঁ; নতুন বুকিং নিশ্চিত হোৱা নাই।",
            hi: "जवाब देने की सेवा में समस्या है। डॉक्टर का चयन रखा है; इस चयन की नई बुकिंग की पुष्टि नहीं हुई है।",
            en: "The response service is temporarily limited. I kept your doctor selection; no new booking is confirmed for this selection." })[input.language], source: "verified_tool" };
        }
        if (read?.turnId === this.turn && (input.isFallback || !this.dialogue.useful(input.text)
          || containsCompletionClaim(input.text, this.phoneConfirmed))) {
          return { text: this.dialogue.render(input.language, this.intakeClarification(input.language, nextIntakeField(this.intake, this.phoneConfirmed))), source: "verified_tool" };
        }
        // Domain acknowledgements are rendered from confirmed effects, never a model claim.
        if (containsCompletionClaim(input.text, this.phoneConfirmed)) {
          return { text: { as: "মই এপইণ্টমেণ্টৰ সফল ফলাফল এতিয়াও নিশ্চিত কৰিব পৰা নাই। অনুগ্ৰহ কৰি তথ্যখিনি পৰীক্ষা কৰোঁ।",
            hi: "अभी अपॉइंटमेंट का परिणाम निश्चित नहीं है। कृपया विवरण जाँचने दें।", en: "I cannot confirm an appointment outcome yet. Let me check the details." }[input.language], source: "recovery" };
        }
        return this.ordinarySpeech(input.text, input.language, this.conversationGoal(), input.isFallback ? "recovery" : "model");
      },
      onResponse: text => {
        if (this.dialogue.state.selectedDoctor) this.slots.doctor = doctorName(this.dialogue.state.selectedDoctor, this.language);
        // The model can ask for a phone before invoking the resolver. Listening mode
        // must follow the actual approved question, without granting caller identity.
        if (!this.phone && !this.phoneConfirmed && !this.draft
          && /ফোন|মোবাইল|phone|mobile|फ़ोन|फोन|मोबाइल/iu.test(text)
          && /[?？]|কওক|ক'ব|দিব|please|tell|provide|say|बताएं|बताइए|दीजिए/iu.test(text)) this.collectingPhone = true;
        // Structured replies carry a goal. Legacy/free-form questions are observed
        // only as context for the next interpretation, never as accepted user facts.
        const asking = /[?？]|কওক|ক'ব|দিব|please|tell|provide|say|बताएं|बताइए|दीजिए/iu.test(text);
        const observed = asking && /বয়স|বয়স|\bage\b|उम्र/iu.test(text) ? "age" : asking && /নাম|\bname\b|नाम/iu.test(text) ? "name"
          : this.collectingPhone ? "phone" : this.conversationGoal();
        this.intake.lastQuestion = { field: this.replyGoal ?? observed, turnId: this.turn, text: text.slice(0, 600) };
        if (this.reply?.turnId === this.turn && this.reply.readback === "phone") { this.phoneHeard = false; this.phoneReadbackTurn = this.turn; }
        if (this.reply?.turnId === this.turn && this.reply.readback === "action" && this.draft) { this.draft.heard = false; this.draft.readbackTurn = this.turn; }
        return this.snapshot();
      },
      onInterruption: turnId => {
        if (this.phoneReadbackTurn === turnId) this.phoneHeard = false;
        if (this.draft?.readbackTurn === turnId) this.draft.heard = false;
      },
      onReset: () => { this.resetCaller(); this.lastReadFailure = null; this.intake = emptyIntake(); this.boundary = this.turn; this.candidates = []; this.activeCandidateId = null; this.previousCandidateId = null; this.completedActions.length = 0; this.failures = 0; this.offered.clear(); this.doctors.clear(); this.slots = {}; this.dialogue.reset(); this.plannedProblem = undefined; },
      onClose: () => { this.closed = true; this.resetCaller(); this.intake = emptyIntake(); this.candidates = []; this.activeCandidateId = null; this.previousCandidateId = null; this.completedActions.length = 0; this.reply = undefined; },
    };
  }
  private ordinarySpeech(text: string, language: AgentLanguage, goal: string, source: "model" | "recovery" = "model"): { text: string; source: "model" | "recovery" | "verified_tool" } {
    const completed = this.completedSpeech(text, language, source);
    if (completed) return completed;
    const asksKnownPhone = this.phoneConfirmed && text.split(/(?<=[.!?।])\s*/u).some(sentence =>
      /ফোন|মোবাইল|নম্বৰ|phone|mobile|number|फ़ोन|फोन|मोबाइल|नंबर/iu.test(sentence)
      && /[?？]|কওক|ক'ব|ক’ব|কবনে|ক'বনে|দিব|শুদ্ধনে|কিমান|\b(?:give|tell|provide|say|dictate)\b|बताएं|बताइए|दीजिए/iu.test(sentence));
    const asksKnownName = this.intake.name && !this.intake.unresolvedName
      && /(?:what(?:'s| is).*name|(?:tell|provide|say).{0,30}name|নাম.{0,15}(?:কওক|দিব|কি\?)|नाम.{0,12}(?:बताएं|बताइए))/iu.test(text);
    const asksKnownAge = this.intake.age && !this.intake.unresolvedAge
      && /(?:what(?:'s| is).{0,20}age|how old|(?:tell|provide).{0,20}age|বয়স.{0,12}(?:কিমান|কওক|দিব)|उम्र.{0,12}(?:बताएं|कितनी))/iu.test(text);
    const asksKnownDoctor = this.dialogue.state.selectedDoctor && /which.{0,20}doctor|কোন(?:জন|টো)?.{0,12}(?:ডাক্তৰ|ডাক্টৰ|ডক্টৰ|চিকিৎসক)|कौन.{0,12}डॉक्टर/iu.test(text);
    const knownDates = [...this.dialogue.state.offeredDates, ...this.dialogue.state.latest?.dates ?? [], ...(this.dialogue.state.selectedDate ? [this.dialogue.state.selectedDate] : [])];
    if (asksKnownPhone || asksKnownName || asksKnownAge || asksKnownDoctor || hasUnverifiedNumericDate(text, knownDates)) return { text: this.intakeClarification(language, goal), source: "verified_tool" };
    const concise = conciseClinicSpeech(text, () => this.intakeClarification(language, goal));
    return { text: concise.text, source: concise.fallback ? "verified_tool" : source };
  }
  private conversationGoal(): NonNullable<ClinicVoiceState["intake"]["lastQuestion"]>["field"] {
    if (this.intake.unresolvedName) return "name";
    if (this.intake.unresolvedAge) return "age";
    if (this.dialogue.state.question === "patient" || ["name", "age"].includes(this.intake.lastQuestion?.field ?? "")) {
      const missing = nextIntakeField(this.intake, this.phoneConfirmed);
      if (missing !== "ready") return missing;
    }
    if (!this.dialogue.state.selectedDoctor) return "doctor";
    if (!this.dialogue.state.selectedDate) return "date";
    if (!this.dialogue.state.selectedSlotId) return "time";
    return nextIntakeField(this.intake, this.phoneConfirmed);
  }
  private intakeClarification(language: AgentLanguage, field: string): string {
    const completed = this.completedReply(language);
    if (completed && (!this.draft || this.draft.completed)) return completed;
    if (field === "name" && this.intake.nonProgress >= 2) return ({ as: "নামটো ধীৰে কওক; প্ৰয়োজন হ'লে বানান কৰি কওক।", hi: "नाम धीरे बोलें; ज़रूरत हो तो उसकी स्पेलिंग बताएं।", en: "Please say the name slowly, or spell it out." })[language];
    if (field === "name") return ({ as: "অনুগ্ৰহ কৰি কেৱল ৰোগীৰ সম্পূৰ্ণ নামটো কওক।", hi: "कृपया सिर्फ मरीज का पूरा नाम बताएं।", en: "Please say just the patient's full name." })[language];
    if (field === "age") return ({ as: "অনুগ্ৰহ কৰি শুদ্ধ বয়সটো এটা এটাকৈ অংকত কওক।", hi: "कृपया सही उम्र के अंक एक-एक करके बताएं।", en: "Please say the correct age using individual digits." })[language];
    if (field === "phone") return ({ as: "আপোনাৰ ফোন নম্বৰটো ইংৰাজীত এটা এটাকৈ অংকত কওক।", hi: "फोन नंबर अंग्रेज़ी में एक-एक अंक बताएं।", en: "Please say your phone number in English digits." })[language];
    if (field === "doctor") return ({ as: "আপোনাৰ দিয়া ৰোগীৰ তথ্য ৰাখিছোঁ। আপুনি কোনজন চিকিৎসক বিচাৰে?", hi: "मरीज के दिए विवरण रखे हैं। कौन से डॉक्टर चाहिए?", en: "I have kept the patient details you supplied. Which doctor would you prefer?" })[language];
    if (field === "date") return ({ as: "আপুনি কোন তাৰিখে যাব বিচাৰে?", hi: "आप किस तारीख को आना चाहते हैं?", en: "Which date would you prefer?" })[language];
    if (field === "time") return ({ as: "উপলব্ধ সময়ৰ কোনটো বাছিব বিচাৰে?", hi: "उपलब्ध समय में कौन सा चुनेंगे?", en: "Which of the available times would you prefer?" })[language];
    return ({ as: "তথ্যখিনি লৈ বুকিঙৰ বিৱৰণ পৰীক্ষা কৰিব পাৰোঁ। এতিয়াও বুক হোৱা নাই।", hi: "अब बुकिंग के विवरण की समीक्षा कर सकते हैं। अभी बुकिंग नहीं हुई है।", en: "The details can now be reviewed before booking. Nothing is booked yet." })[language];
  }
  private syncSelection() {
    const date = this.dialogue.state.selectedDate;
    const slot = this.dialogue.state.offeredSlots.find(s => s.id === this.dialogue.state.selectedSlotId);
    if (date) this.slots.dateOrTime = `${date}${slot ? ` ${slot.startTime}` : ""}`;
    else delete this.slots.dateOrTime;
  }
  snapshot(): ClinicVoiceState {
    return clinicVoiceStateSchema.parse({ intake: this.intake, contextBoundary: this.boundary, slots: { ...this.slots }, phoneConfirmed: this.phoneConfirmed,
      collectingPhone: this.collectingPhone, patientId: this.patientId ?? null, pendingDraftId: this.draft?.id ?? null,
      dialogue: this.dialogue.state, lastReadFailure: this.lastReadFailure,
      phoneCandidates: this.candidates, activeCandidateId: this.activeCandidateId, previousCandidateId: this.previousCandidateId,
      phoneReadbackTurn: this.phoneReadbackTurn ?? null, phoneReadbackCompleted: this.phoneHeard,
      pendingAction: this.draft && !this.draft.completed ? { id: this.draft.id, kind: this.draft.kind,
        readback: this.actionReadback, readbackTurn: this.draft.readbackTurn ?? null, completedPlayback: this.draft.heard,
        authorizedTurn: this.draft.authorizedTurn ?? null } : null, completedActions: this.completedActions,
      authorizedAppointments: [...this.grants.keys()] });
  }
  planTurn(text: string, enabled: readonly string[], patientAnswer = false): TurnOptions["initialToolCall"] {
    // Specialized phone listening must not reinterpret digit fragments as calendar/doctor requests.
    if (this.collectingPhone || (this.phone && !this.phoneConfirmed) || (this.draft && !this.draft.completed)) return undefined;
    const slot = this.dialogue.state.offeredSlots.find(s => s.id === this.dialogue.state.selectedSlotId);
    const requestBooking = /\bplease book\b|\bbook (?:it|the appointment|an appointment)\b|বুক\s*(?:কৰি\s*)?(?:কৰক|দিয়ক|দিয়া)|बुक\s*(?:कर|कीजिए)/iu.test(text)
      && !/\b(?:not|no|don't|cancel)\b|নকৰ|নালাগ|নহয়|নহয়|বাতিল|नहीं/iu.test(text);
    if (requestBooking && !this.draft && this.phoneConfirmed && !this.intake.unresolved && nextIntakeField(this.intake, true) === "ready"
      && this.dialogue.state.selectedDoctor && slot) {
      if (!enabled.includes("book_appointment")) { this.plannedProblem = "disabled"; return undefined; }
      return { name: "book_appointment", arguments: { mode: "prepare", doctorId: this.dialogue.state.selectedDoctor.id, slotId: slot.id,
        patientName: this.intake.name!.value, patientAge: this.intake.age!.value } };
    }
    const plan = this.dialogue.plan(text, clinicLocalDate(this.deps.now?.() ?? new Date(), this.dialogue.timezone), patientAnswer);
    this.plannedProblem = plan.guidance;
    if (plan.call && !enabled.includes(plan.call.name)) { this.plannedProblem = "disabled"; return undefined; }
    return plan.call;
  }
  hasPlannedGuidance() { return Boolean(this.plannedProblem); }
  getConfirmationStage(): "phone" | "action" | "confirmed" | "none" {
    return this.draft && !this.draft.completed ? "action" : this.phoneConfirmed ? "confirmed" : this.phone ? "phone" : "none";
  }
  private callerActions() { return this.completedActions.filter(action => action.turnId >= this.boundary); }
  private completedSummary() {
    const action = this.callerActions().at(-1); if (!action) return null;
    if (action.kind === "booking" && "tokenNumber" in action.result) return { outcome: "booked" as const, appointmentId: action.result.appointmentId,
      doctorId: action.result.doctorId, date: action.result.appointmentDate, time: action.result.appointmentTime, token: action.result.tokenNumber };
    return { outcome: "cancelled" as const, appointmentId: action.result.appointmentId };
  }
  private completedReply(language: AgentLanguage): string | undefined {
    const completed = this.completedSummary();
    if (!completed) return undefined;
    return completed.outcome === "booked" ? ({
      as: `আপোনাৰ এপইণ্টমেণ্ট বুক হ'ল। টোকেন নম্বৰ ${completed.token}। আৰু প্ৰশ্ন নাথাকিলে ফোনটো ৰাখিব পাৰে।`,
      hi: `आपकी अपॉइंटमेंट बुक है। टोकन ${completed.token}। कोई और सवाल न हो तो कॉल समाप्त कर सकते हैं।`,
      en: `Your appointment is booked. Token ${completed.token}. You can end the call if you have no more questions.`,
    })[language] : ({ as: "আপোনাৰ এপইণ্টমেণ্ট বাতিল কৰা হ'ল। আৰু প্ৰশ্ন নাথাকিলে ফোনটো ৰাখিব পাৰে।",
      hi: "आपकी अपॉइंटमेंट रद्द हो गई है। कोई और सवाल न हो तो कॉल समाप्त कर सकते हैं।",
      en: "Your appointment has been cancelled. You can end the call if you have no more questions." })[language];
  }
  /** Keep natural model wording after commit; only contradictory/invalid replies use the receipt. */
  private completedSpeech(text: string, language: AgentLanguage, source: "model" | "recovery"): { text: string; source: "model" | "verified_tool" } | undefined {
    const completed = this.completedSummary();
    if (!completed || (this.draft && !this.draft.completed)) return undefined;
    const fallback = this.completedReply(language)!;
    const normalized = asciiNumberText(text);
    const reconfirm = /(?:shall|should|would|can)\s+(?:i|we).{0,40}(?:book|confirm)|(?:please|you).{0,30}confirm|নিশ্চিত\s*কৰিবনে|বুক\s*(?:কৰিমনে|কৰিবনে|কৰক)|क्या.{0,25}(?:बुक|पुष्टि)/iu.test(text);
    const deniedBooking = /\b(?:not|nothing|never).{0,35}(?:booked|confirmed)\b|এতিয়াও.{0,20}বুক.{0,15}নাই|বুক\s*হোৱা\s*নাই|बुक.{0,20}नहीं/iu.test(text);
    const wrongOutcome = completed.outcome === "booked"
      ? deniedBooking || /\b(?:cancelled|canceled)\b|বাতিল\s*কৰা|रद्द\s*(?:हो|कर)/iu.test(text)
      : /\b(?:booked|confirmed)\b|বুক\s*হ|নিশ্চিত|बुक\s*(?:हो|हुआ)/iu.test(text);
    const tokens = [...normalized.matchAll(/(?:token(?:\s+(?:number|no\.?))?|টোকেন(?:\s*নম্বৰ)?|टोकन(?:\s*नंबर)?)\s*[:#]?\s*(\d+)/giu)];
    const wrongToken = tokens.some(match => completed.outcome !== "booked" || Number(match[1]) !== completed.token);
    const wrongDate = completed.outcome === "booked" && hasUnverifiedNumericDate(text, [completed.date]);
    if (source === "recovery" || reconfirm || wrongOutcome || wrongToken || wrongDate) return { text: fallback, source: "verified_tool" };
    const concise = conciseClinicSpeech(text, () => fallback);
    return { text: concise.text, source: concise.fallback ? "verified_tool" : "model" };
  }
  private turnTools(): string[] {
    if (this.phoneConfirmed && this.dialogue.state.offeredSlots.length) {
      return ["resolve_clinic_and_caller", "book_appointment", "check_my_appointments", "cancel_appointment"];
    }
    if (this.callerActions().length) return ["resolve_clinic_and_caller", "check_my_appointments", "cancel_appointment"];
    const tools = ["list_doctors", "find_doctor", "resolve_clinic_and_caller"];
    if (this.dialogue.state.selectedDoctor) tools.push("get_available_dates", "get_available_times");
    if (this.phoneConfirmed) tools.push("check_my_appointments", "cancel_appointment");
    if (this.phoneConfirmed && this.dialogue.state.offeredSlots.length) tools.push("book_appointment");
    return tools;
  }
  private availabilityDoctor(supplied?: string): ToolResult<{ id: string }> {
    const selected = this.dialogue.state.selectedDoctor;
    if (selected && supplied && supplied !== selected.id) return failure("DOCTOR_SELECTION_MISMATCH", "Use the selected doctor; find a different doctor before changing the selection.");
    const known = selected ?? this.dialogue.state.candidates.find(d => d.id === supplied && d.isActive);
    if (!known) return failure("DOCTOR_SELECTION_REQUIRED", "Find and select a returned doctor first.");
    if (!selected) { const previous = this.dialogue.state.selectedDoctor?.id; this.dialogue.select(known); this.selectReadDoctor(previous); }
    return ok({ id: known.id });
  }
  private readFailureReply(language: AgentLanguage): string {
    const selected = this.dialogue.state.selectedDoctor;
    const name = selected ? doctorName(selected, language) : "";
    const operation = this.lastReadFailure?.toolName;
    const subject = operation === "get_available_times" ? { as: "উপলব্ধ সময়ৰ", hi: "उपलब्ध समय की", en: "available times" }
      : operation === "get_available_dates" ? { as: "উপলব্ধ তাৰিখৰ", hi: "उपलब्ध तारीखों की", en: "available dates" }
      : { as: "চিকিৎসকৰ", hi: "डॉक्टर की", en: "doctor details" };
    const noBooking = !this.callerActions().length && !this.draft?.completed;
    return ({ as: `${name ? `${name}ৰ বাছনি ৰাখিছোঁ। ` : ""}${subject.as} তথ্য আনিব পৰা নাই। ${noBooking ? "এই বাছনিৰ নতুন বুকিং নিশ্চিত হোৱা নাই। " : ""}আকৌ পৰীক্ষা কৰিমনে?`,
      hi: `${name ? `${name} का चयन रखा है। ` : ""}${subject.hi} जानकारी नहीं मिल सकी। ${noBooking ? "इस चयन की नई बुकिंग की पुष्टि नहीं हुई है। " : ""}क्या फिर देखें?`,
      en: `${name ? `I have kept ${name} selected. ` : ""}I could not retrieve ${subject.en}. ${noBooking ? "No new booking is confirmed for this selection. " : ""}Shall I check again?` })[language];
  }
  private selectReadDoctor(previous: string | undefined) {
    const selected = this.dialogue.state.selectedDoctor;
    if (selected?.id !== previous) {
      this.lastReadFailure = null;
      this.offered.clear(); delete this.slots.dateOrTime;
      if (this.draft?.kind === "booking" && !this.draft.completed) this.draft = undefined;
    }
    if (selected) this.slots.doctor = doctorName(selected, this.language); else delete this.slots.doctor;
  }
  private services(requestKey?: string, draft?: Extract<Draft, { kind: "booking" }>, cancellation?: Upcoming) {
    return createClinicServices({ organizationId: this.context.organizationId, source: "voice", callId: this.callId,
      ...(this.patientId ? { patientId: this.patientId } : {}), ...(requestKey ? { requestKey } : {}),
      ...(draft ? { slotExpectation: { date: draft.slot.slotDate, startTime: draft.slot.startTime.slice(0, 5), timezone: draft.timezone } } : {}),
      ...(cancellation ? { slotExpectation: { date: cancellation.appointmentDate, startTime: cancellation.appointmentTime.slice(0, 5), timezone: cancellation.timezone },
        ...(cancellation.version !== undefined ? { appointmentExpectation: { version: cancellation.version } } : {}) } : {}) }, this.deps);
  }
  private async bindConfirmedPatient(ctx: ToolContext): Promise<ToolResult<{ id: string }>> {
    if (!this.phoneConfirmed) return failure("CALLER_REQUIRED", "Confirm the caller phone first.");
    if (this.patientId) return ok({ id: this.patientId });
    const patient = await this.service.getOrCreatePatient({ phoneNumber: this.phone });
    this.check(ctx); if (!patient.success) return patient;
    this.patientId = patient.data.id; return ok({ id: patient.data.id });
  }
  private resetCaller() {
    this.phone = ""; this.phoneText = ""; this.phoneHeard = false; this.phoneConfirmed = false;
    this.patientId = undefined; this.draft = undefined; this.grants.clear(); this.collectingPhone = false;
    delete this.slots.phoneNumber;
    this.phoneReadbackTurn = undefined;
  }
  private setPhone(phone: string) {
    if (phone !== this.phone) {
      if (this.phone) { this.boundary = this.turn; this.intake = emptyIntake(); delete this.slots.patientName; }
      this.resetCaller(); this.phone = phone; this.slots.phoneNumber = phone;
    }
    let candidate = this.candidates.find(c => c.digits === phone);
    if (!candidate) { candidate = { id: randomUUID(), digits: phone }; this.candidates.push(candidate); this.candidates = this.candidates.slice(-5); }
    if (this.activeCandidateId !== candidate.id) this.previousCandidateId = this.activeCandidateId;
    this.activeCandidateId = candidate.id;
    if (!this.candidates.some(c => c.id === this.previousCandidateId)) this.previousCandidateId = null;
  }
  private say(text: (language: AgentLanguage) => string, readback?: "phone" | "action") {
    this.replySource = "verified_tool";
    this.reply = { turnId: this.turn, text, ...(readback ? { readback } : {}) };
  }
  private phoneReadback() {
    this.collectingPhone = false;
    this.say(lang => ({ as: `মই ${formatPhoneNumberForSpeech(this.phone)} নম্বৰটো শুনিলোঁ। নম্বৰটো শুদ্ধনে?`,
      hi: `मैंने ${this.phone.split("").join(" ")} सुना। क्या नंबर सही है?`,
      en: `I heard ${this.phone.split("").join(" ")}. Is that phone number correct?` })[lang], "phone");
  }
  private clarifyPhone() {
    // A short clarification does not replace the completed readback of this
    // unchanged candidate. Unheard/replaced numbers still require full playback.
    if (!this.phoneHeard) { this.phoneReadback(); return; }
    this.say(lang => ({ as: "নম্বৰটো শুদ্ধ নে সলনি কৰিব লাগে?",
      hi: "क्या नंबर सही है या बदलना है?", en: "Is that number correct, or should it change?" })[lang]);
  }
  private askFullNumber() {
    this.say(lang => ({ as: "নম্বৰটো সলনি কৰা নাই। অনুগ্ৰহ কৰি সম্পূৰ্ণ শুদ্ধ নম্বৰটো ইংৰাজীত এটা এটাকৈ কওক, অথবা আগৰ নম্বৰটো ৰাখিব বিচাৰে নে কওক।",
      hi: "नंबर अभी नहीं बदला है। पूरा सही नंबर अंग्रेज़ी में एक-एक अंक बताएं, या बताएं कि पिछला नंबर रखना है।",
      en: "I have kept the number unconfirmed. Please give the complete corrected number in English digits, or tell me to keep the previous number." })[lang]);
  }
  private unconfirmPhone() {
    this.phoneConfirmed = false; this.phoneHeard = false; this.patientId = undefined; this.grants.clear();
    if (this.draft && !this.draft.completed) this.draft = undefined;
  }
  private async accept(text: string, turnId: number, preparation: TurnPreparationContext) {
    this.turn = turnId; this.reply = undefined; this.prepared = false; this.replySource = "verified_tool";
    this.actionCorrection = false; this.replyGoal = undefined;
    const draft = this.draft && !this.draft.completed ? this.draft : undefined;
    if (draft) draft.authorizedTurn = undefined;
    if ((this.phone && !this.phoneConfirmed) || draft || (this.candidates.length > 0 && this.collectingPhone)) {
      const decision = await this.interpret({ text, turnId, language: preparation.language, history: preparation.history,
        candidates: this.candidates, activeCandidateId: this.activeCandidateId, previousCandidateId: this.previousCandidateId,
        collectingPhone: this.collectingPhone, phoneReadbackCompleted: this.phoneHeard,
        draft: draft ? { id: draft.id, kind: draft.kind, readback: this.actionReadback, completedPlayback: draft.heard } : null }, preparation.signal);
      preparation.signal.throwIfAborted();
      if (this.closed || this.turn !== turnId) throw new DOMException("Turn superseded", "AbortError");
      const candidate = this.candidates.find(c => c.id === decision.targetId);
      if (decision.intent === "confirm" && decision.targetId === this.activeCandidateId && this.phoneHeard && this.phoneReadbackTurn !== turnId) {
        this.phoneConfirmed = true; this.collectingPhone = false;
      } else if (decision.intent === "confirm" && draft && decision.targetId === draft.id && draft.heard && draft.readbackTurn !== turnId) {
        draft.authorizedTurn = turnId;
      } else if (decision.intent === "restore_previous" && candidate) {
        this.setPhone(candidate.digits); this.unconfirmPhone(); this.phoneReadback(); this.prepared = true; return;
      } else if (decision.intent === "replace_number") {
        const replacement = normalizePhoneNumber(decision.replacementText ?? "");
        if (replacement.isValid && !replacement.unrecognizedTokens.length && !replacement.hasPendingMultiplier) {
          this.setPhone(replacement.digits); this.unconfirmPhone(); this.phoneReadback();
        } else { this.unconfirmPhone(); this.collectingPhone = true; this.askFullNumber(); }
        this.prepared = true; return;
      } else if ((decision.intent === "correct_action" || decision.intent === "cancel_pending" || decision.intent === "reject") && draft && decision.targetId === draft.id) {
        draft.heard = false; this.draft = undefined;
        this.actionCorrection = decision.intent === "correct_action";
        this.say(lang => ({ as: "কামটো কৰা হোৱা নাই। কোন তথ্য সলনি কৰিব বিচাৰে?", hi: "कार्रवाई नहीं की गई। कौन सा विवरण बदलना है?", en: "That action has not been performed. Which detail would you like to change?" })[lang]);
        this.prepared = true; return;
      } else if (decision.intent === "reject" && candidate) {
        this.unconfirmPhone(); this.collectingPhone = true;
        this.askFullNumber(); this.prepared = true; return;
      } else {
        if (draft) this.readback(draft); else if (this.phone) this.clarifyPhone();
        this.prepared = true; return;
      }
    }
    const part = normalizePhoneNumber(text);
    if (part.isValid && !part.unrecognizedTokens.length && !part.hasPendingMultiplier) {
      if (part.digits !== this.phone) this.setPhone(part.digits);
      if (!this.phoneConfirmed) this.phoneReadback();
    } else if (this.collectingPhone) {
      const combined = normalizePhoneNumber([this.phoneText, text].join(" "));
      if (!combined.unrecognizedTokens.length && combined.digitCount <= 10) {
        this.phoneText = [this.phoneText, text].join(" ").trim();
        if (combined.isValid && !combined.hasPendingMultiplier) { this.setPhone(combined.digits); this.phoneReadback(); }
      } else this.phoneText = "";
      if (!this.phone) {
        const count = normalizePhoneNumber(this.phoneText).digitCount;
        this.say(lang => ({ as: count ? `মই ${count}টা অংক শুনিলোঁ। বাকী অংককেইটা কওক; মই শুনি আছোঁ।` : "অংককেইটা স্পষ্ট নহ'ল। অনুগ্ৰহ কৰি নম্বৰটো এটা এটাকৈ আকৌ কওক।",
          hi: count ? `मैंने ${count} अंक सुने। कृपया बाकी अंक बताएं।` : "अंक स्पष्ट नहीं हुए। कृपया नंबर एक-एक अंक दोबारा बताएं।",
          en: count ? `I heard ${count} digits. Please continue; I'm listening.` : "Those digits were unclear. Please say the number again, one digit at a time." })[lang]);
      }
    }
    if (this.reply) this.prepared = true;
  }
  private check(context: ToolContext) {
    context.signal.throwIfAborted();
    if (this.closed || context.turnId !== this.turn || context.organizationId !== this.context.organizationId || context.agentId !== this.context.agentId
      || context.sessionId !== this.context.sessionId || context.callId !== this.callId || context.conversationId !== this.conversationId) throw new Error("Invalid clinic tool context");
  }
  private async serialize<T>(context: ToolContext, fn: () => Promise<T>): Promise<T> {
    const pending = this.mutations.then(() => { this.check(context); return fn(); });
    this.mutations = pending.catch(() => undefined); return pending;
  }
  private makeRegistry() {
    const tool = <I, O>(name: string, description: string, inputSchema: z.ZodType<I>, outputSchema: z.ZodType<O>, execute: (input: I, context: ToolContext) => Promise<ToolResult<O>>) =>
      defineTool({ name, description, inputSchema, outputSchema,
        ...(["list_doctors", "find_doctor", "get_available_dates", "get_available_times"].includes(name) ? { modelOutputSchema: clinicReadModelSchema,
          projectOutput: (output: O, input: I) => projectClinicRead(name, output, z.object({ offset: readOffset }).parse(input).offset ?? 0, this.language, this.dialogue.state.selectedSlotId) } : {}),
        execute: async (input, context) => {
        this.check(context); await this.mutations; this.check(context);
        const result = await execute(input, context);
        this.check(context);
        if (["list_doctors", "find_doctor", "get_available_dates", "get_available_times"].includes(name)) {
          const attempted = z.object({ date: dateSchema.optional() }).safeParse(input);
          this.lastReadFailure = result.success ? null : { toolName: name, code: result.error.code, turnId: this.turn,
            date: attempted.success ? attempted.data.date ?? null : null };
          if (!result.success) this.dialogue.problem(this.turn, "service_error");
        }
        if (!result.success && (name === "book_appointment" || name === "cancel_appointment") && !this.reply) {
          this.say(lang => ({ as: "এই কামটো সম্পূৰ্ণ হোৱা বুলি নিশ্চিত কৰিব পৰা নাই। অনুগ্ৰহ কৰি তথ্যখিনি পৰীক্ষা কৰোঁ।",
            hi: "इस कार्रवाई की पुष्टि नहीं हुई है। कृपया विवरण जाँचने दें।", en: "That action is not confirmed. Let me check the details." })[lang]);
        }
        return result;
      } });
    return new ToolRegistry([
      tool("resolve_clinic_and_caller", "Resolve the trusted clinic/caller using server-captured phone state. Input is empty. Never submit a phone number or infer digits. An already confirmed phone must not be requested again.",
        empty, resolverOutput, (_input, ctx) => this.serialize(ctx, async () => {
          const result = await this.service.resolveClinic(); if (!result.success) return result;
          this.check(ctx);
          const { name, timezone, localDate, localTime } = result.data;
          this.dialogue.timezone = timezone;
          if (this.phone && !this.phoneConfirmed) this.phoneReadback();
          if (!this.phone) {
            this.collectingPhone = true;
            if (this.reply?.turnId !== this.turn) this.say(lang => ({ as: "অনুগ্ৰহ কৰি আপোনাৰ ফোন নম্বৰৰ প্ৰতিটো অংক ইংৰাজীত কওক।", hi: "कृपया अपना फोन नंबर अंग्रेज़ी में एक-एक अंक बताएं।", en: "Please say your phone number in English, one digit at a time." })[lang]);
          }
          if (this.phoneConfirmed && !this.patientId) {
            const patient = await this.bindConfirmedPatient(ctx); if (!patient.success) return patient;
          }
          return ok({ clinic: { name, timezone, localDate, localTime }, callerResolved: Boolean(this.patientId), phoneNeedsConfirmation: Boolean(this.phone && !this.phoneConfirmed) });
        })),
      tool("list_doctors", "List actual active doctors. Optional specialty filters stored specialization only; no match returns actual alternatives. Use these IDs; never invent doctors.",
        z.object({ specialty: z.string().trim().min(1).max(100).optional(), offset: readOffset }).strict(), doctorResultSchema, async (input, ctx) => {
        const result = await this.service.listActiveDoctors(); this.check(ctx);
        if (!result.success) return result;
        result.data.forEach(d => this.doctors.set(d.id, doctorName(d, this.language)));
        const all: VoiceDoctor[] = result.data.map(d => ({ ...d, isActive: true }));
        const matches = input.specialty ? all.filter(d => d.specialization?.toLowerCase().includes(input.specialty!.toLowerCase())) : all;
        return ok(this.dialogue.doctors(this.turn, matches, input.specialty ? all : [], input.specialty ?? null, true));
      }),
      tool("find_doctor", "Find all stored matches for a spoken doctor name. Clarify multiple matches. If none match, list doctors and ask the caller to choose.",
        z.object({ name: z.string().trim().min(1).max(100), offset: readOffset }).strict(), doctorResultSchema, async (input, ctx) => {
          const namePart = normalizeDoctorName(input.name); if (!namePart) return failure("INVALID_TOOL_INPUT", "Please provide the doctor's name.");
          const result = await this.service.findDoctorsByName({ namePart }); this.check(ctx);
          if (!result.success) return result;
          const previous = this.dialogue.state.selectedDoctor?.id;
          let alternatives: VoiceDoctor[] = [];
          if (!result.data.length || !result.data.some(d => d.isActive)) {
            const active = await this.service.listActiveDoctors(); this.check(ctx);
            if (!active.success) return active;
            alternatives = active.data.map(d => ({ ...d, isActive: true }));
          }
          const data = this.dialogue.doctors(this.turn, result.data, alternatives);
          this.selectReadDoctor(previous);
          result.data.filter(d => d.isActive).forEach(d => this.doctors.set(d.id, doctorName(d, this.language)));
          return ok(data);
        }),
      tool("get_available_dates", "Get actual available clinic-local dates for a doctor. Do not infer availability from a request.",
        z.object({ doctorId: z.uuid().optional(), offset: readOffset }).strict(), z.object({ dates: z.array(dateSchema), timezone: z.string(), localDate: dateSchema,
          outcome: readStateSchema.shape.latest.unwrap().shape.outcome, resultCount: z.number().int(),
          calendar: z.array(z.object({ date: dateSchema, weekday: z.string(), labelEn: z.string(), timezone: z.string() }).strict()) }).strict(), async (input, ctx) => {
          const doctor = this.availabilityDoctor(input.doctorId); if (!doctor.success) return doctor;
          const info = await this.service.resolveClinic(); if (!info.success) return info;
          const dates = await this.service.listAvailableDates({ doctorId: doctor.data.id }); if (!dates.success) return dates;
          this.check(ctx); this.dialogue.timezone = info.data.timezone;
          const calendar = this.dialogue.dates(this.turn, dates.data, input.offset ?? 0);
          return ok({ dates: dates.data, timezone: info.data.timezone, localDate: info.data.localDate, calendar,
            outcome: this.dialogue.state.latest!.outcome, resultCount: dates.data.length });
        }),
      tool("get_available_times", "Get actual slots and remaining capacity for a doctor/date; offer stored times and IDs only.",
        z.object({ doctorId: z.uuid().optional(), date: dateSchema, offset: readOffset }).strict(), z.object({ times: z.array(slotSummarySchema), timezone: z.string(),
          outcome: readStateSchema.shape.latest.unwrap().shape.outcome, resultCount: z.number().int(),
          calendar: z.object({ date: dateSchema, weekday: z.string(), labelEn: z.string(), timezone: z.string() }).strict() }).strict(), async (input, ctx) => {
          const doctor = this.availabilityDoctor(input.doctorId); if (!doctor.success) return doctor;
          const info = await this.service.resolveClinic(); if (!info.success) return info;
          const times = await this.service.listAvailableSlots({ doctorId: doctor.data.id, date: input.date }); this.check(ctx); if (!times.success) return times;
          times.data.forEach(slot => this.offered.set(slot.id, { doctorId: doctor.data.id, slot }));
          this.dialogue.timezone = info.data.timezone;
          this.dialogue.times(this.turn, input.date, times.data);
          this.slots.dateOrTime = `${input.date}${this.dialogue.state.selectedSlotId ? ` ${times.data.find(slot => slot.id === this.dialogue.state.selectedSlotId)!.startTime}` : ""}`;
          const failedDraft = this.draft;
          if (failedDraft?.kind === "booking" && failedDraft.completed && !failedDraft.result && times.data.some(slot => slot.id === failedDraft.input.slotId)) this.draft = undefined;
          return ok({ times: times.data, timezone: info.data.timezone, outcome: this.dialogue.state.latest!.outcome,
            resultCount: times.data.length, calendar: calendarDate(input.date, info.data.timezone) });
        }),
      tool("book_appointment", "Use mode prepare with doctorId, slotId, patientName, patientAge and optional complaint to read back a draft, without booking. After a later affirmative caller turn use mode confirm and draftId. Only outcome booked confirms success; unavailable requires a new choice and confirmation.",
        z.object({ mode: z.enum(["prepare", "confirm"]), doctorId: z.uuid().optional(), slotId: z.uuid().optional(),
          patientName: z.string().trim().min(2).max(100).optional(), patientAge: z.number().int().min(0).max(120).optional(),
          complaint: z.string().trim().min(3).max(500).optional(), draftId: z.uuid().optional() }).strict(), bookingOutput,
        (input, ctx) => this.serialize(ctx, async () => {
          if (!this.phoneConfirmed) return failure("CALLER_REQUIRED", "Resolve and confirm the caller phone first.");
          if (input.mode === "prepare") {
            if (this.interpretIntake && (!this.intake.name || !this.intake.age)) return failure("PATIENT_DETAILS_REQUIRED", "Collect the patient's actual name and age before preparing a booking.");
            if (this.intake.unresolved || (this.intake.name && input.patientName !== this.intake.name.value) || (this.intake.age && input.patientAge !== this.intake.age.value)) return failure("PATIENT_DETAILS_REQUIRED", "Clarify the patient's actual name and age before preparing a booking.");
            if (input.draftId) return failure("INVALID_TOOL_INPUT", "Prepare a new draft without a draft ID.");
            const selected = input.slotId ? this.offered.get(input.slotId) : undefined;
            if (!input.doctorId || !selected || selected.doctorId !== input.doctorId || !this.doctors.has(input.doctorId)) return failure("SLOT_SELECTION_REQUIRED", "List doctors and available times, then choose a returned slot.");
            if (!input.patientName || input.patientAge === undefined) return failure("PATIENT_DETAILS_REQUIRED", "Provide the actual patient name and age.");
            const patient = await this.bindConfirmedPatient(ctx); if (!patient.success) return patient;
            const parsed = bookingInputSchema.safeParse({ doctorId: input.doctorId, slotId: input.slotId, patientId: this.patientId,
              patientName: input.patientName, patientAge: input.patientAge, ...(input.complaint ? { complaint: input.complaint } : {}) });
            if (!parsed.success) return failure("PATIENT_DETAILS_REQUIRED", "Ask for the patient's actual name and age before preparing a booking.");
            if (this.draft?.kind === "booking" && JSON.stringify(this.draft.input) === JSON.stringify(parsed.data)
              && this.draft.slot.slotDate === selected.slot.slotDate && this.draft.slot.startTime === selected.slot.startTime) {
              if (this.draft.result) { this.booked(this.draft.result); return ok({ outcome: "booked" as const, appointment: this.draft.result }); }
              if (!this.draft.completed) { this.readback(this.draft); return ok({ outcome: "confirmation_required" as const, draftId: this.draft.id }); }
              return failure("SLOT_SELECTION_REQUIRED", "Choose a fresh available slot and confirm again.");
            }
            const clinic = await this.service.resolveClinic(); if (!clinic.success) return clinic;
            this.check(ctx);
            this.draft = { id: randomUUID(), heard: false, kind: "booking", input: parsed.data, slot: selected.slot, doctorName: this.doctors.get(input.doctorId)!, timezone: clinic.data.timezone };
            this.slots = { ...this.slots, doctor: this.draft.doctorName, dateOrTime: `${selected.slot.slotDate} ${selected.slot.startTime}`, patientName: parsed.data.patientName };
            this.readback(this.draft); return ok({ outcome: "confirmation_required" as const, draftId: this.draft.id });
          }
          if (!this.patientId) return failure("CALLER_REQUIRED", "Resolve and confirm the caller phone first.");
          if (Object.keys(input).some(k => k !== "mode" && k !== "draftId")) return failure("INVALID_TOOL_INPUT", "Confirm only the server-issued draft ID.");
          const draft = this.draft;
          if (!draft || draft.kind !== "booking" || draft.id !== input.draftId) return failure("DRAFT_NOT_FOUND", "Prepare the booking details again.");
          if (draft.result) { this.booked(draft.result); return ok({ outcome: "booked" as const, appointment: draft.result }); }
          if (draft.completed) return failure("SLOT_SELECTION_REQUIRED", "Refresh available times and make a new selection before preparing another booking.");
          if (draft.authorizedTurn !== ctx.turnId) { this.readback(draft); return failure("CONFIRMATION_REQUIRED", "Wait for the caller to confirm the readback on a later turn."); }
          ctx.signal.throwIfAborted();
          // Retain committed effects even if the executor/speech is cancelled while PostgreSQL is running.
          const result = await this.services(draft.id, draft).createAppointmentFromBooking(draft.input);
          if (result.success) {
            draft.result = result.data; draft.completed = true;
            this.completedActions.push({ id: draft.id, turnId: ctx.turnId, kind: draft.kind, result: result.data });
            const appointment = { appointmentId: result.data.appointmentId, doctorId: result.data.doctorId, doctorName: draft.doctorName,
              version: 1, tokenNumber: result.data.tokenNumber, appointmentDate: result.data.appointmentDate, appointmentTime: result.data.appointmentTime, timezone: result.data.timezone };
            if (this.patientId === draft.input.patientId) this.grants.set(appointment.appointmentId, appointment);
            if (!ctx.signal.aborted && ctx.turnId === this.turn) this.booked(result.data);
            return ok({ outcome: "booked" as const, appointment: result.data });
          }
          if (result.error.code !== "SLOT_UNAVAILABLE") return result;
          draft.completed = true; draft.authorizedTurn = undefined;
          const dates = await this.service.listAvailableDates({ doctorId: draft.input.doctorId });
          if (!dates.success) return dates;
          const times = dates.data[0] ? await this.service.listAvailableSlots({ doctorId: draft.input.doctorId, date: dates.data[0] }) : ok([] as Slot[]);
          if (!times.success) return times;
          times.data.forEach(slot => this.offered.set(slot.id, { doctorId: draft.input.doctorId, slot }));
          const info = await this.service.resolveClinic(); if (!info.success) return info;
          if (!ctx.signal.aborted && ctx.turnId === this.turn) this.say(lang => ({ as: `সেই সময়টো এতিয়া উপলব্ধ নহয়। ${times.data.map(s => `${s.slotDate} ${s.startTime}`).join(", ") || "আন সময় পোৱা নগ'ল"}। অনুগ্ৰহ কৰি নতুন সময় বাছক।`,
            hi: `वह समय उपलब्ध नहीं है। ${times.data.map(s => `${s.slotDate} ${s.startTime}`).join(", ") || "अन्य समय नहीं मिला"}। कृपया नया समय चुनें।`,
            en: `That slot is no longer available. ${times.data.map(s => `${s.slotDate} ${s.startTime}`).join(", ") || "No alternatives are available"}. Please choose again.` })[lang]);
          return ok({ outcome: "unavailable" as const, dates: dates.data, times: times.data, timezone: info.data.timezone });
        })),
      tool("check_my_appointments", "Retrieve only appointments created in this session, or verify an existing booking with its token number and exact date. Phone alone is insufficient. Supply doctorId if token/date are ambiguous.",
        z.object({ tokenNumber: z.number().int().positive().optional(), date: dateSchema.optional(), doctorId: z.uuid().optional() }).strict(), z.array(upcomingSummarySchema), async (input, ctx) => {
          if (!this.patientId) return failure("CALLER_REQUIRED", "Resolve and confirm the caller phone first.");
          const result = await this.services().listUpcomingAppointmentsForPatient({ patientId: this.patientId }); this.check(ctx); if (!result.success) return result;
          if (input.tokenNumber === undefined && input.date === undefined) return ok(result.data.filter(a => this.grants.has(a.appointmentId)));
          if (this.failures >= 3) return failure("APPOINTMENT_ACCESS_DENIED", "Appointment details could not be verified. Please contact the clinic.");
          const matches = result.data.filter(a => a.tokenNumber === input.tokenNumber && a.appointmentDate === input.date && (!input.doctorId || a.doctorId === input.doctorId));
          if (matches.length !== 1) { this.failures++; return failure("APPOINTMENT_ACCESS_DENIED", "Appointment details could not be verified. Check the token, date and doctor."); }
          this.grants.set(matches[0]!.appointmentId, matches[0]!); return ok(matches);
        }),
      tool("cancel_appointment", "Prepare cancellation of an appointment returned by authorized lookup using appointmentId and reason. After caller confirms the readback, confirm using draftId. Never cancel by an unverified ID.",
        z.object({ mode: z.enum(["prepare", "confirm"]), appointmentId: z.uuid().optional(), reason: z.string().trim().min(1).max(500).optional(), draftId: z.uuid().optional() }).strict(), cancellationOutput,
        (input, ctx) => this.serialize(ctx, async () => {
          if (!this.patientId) return failure("CALLER_REQUIRED", "Resolve and confirm the caller phone first.");
          if (input.mode === "prepare") {
            const appointment = input.appointmentId ? this.grants.get(input.appointmentId) : undefined;
            if (!appointment || !input.reason || input.draftId) return failure("APPOINTMENT_ACCESS_DENIED", "Verify the appointment and supply a cancellation reason first.");
            this.draft = { id: randomUUID(), heard: false, kind: "cancellation", appointment, reason: input.reason };
            this.readback(this.draft); return ok({ outcome: "confirmation_required" as const, draftId: this.draft.id });
          }
          if (Object.keys(input).some(k => k !== "mode" && k !== "draftId")) return failure("INVALID_TOOL_INPUT", "Confirm only the server-issued draft ID.");
          const draft = this.draft;
          if (!draft || draft.kind !== "cancellation" || draft.id !== input.draftId) return failure("DRAFT_NOT_FOUND", "Prepare cancellation again.");
          if (draft.result) { this.cancelled(); return ok({ outcome: "cancelled" as const, cancellation: draft.result }); }
          if (draft.authorizedTurn !== ctx.turnId) { this.readback(draft); return failure("CONFIRMATION_REQUIRED", "Wait for the caller to confirm cancellation on a later turn."); }
          const result = await this.services(undefined, undefined, draft.appointment).cancelAppointment({ appointmentId: draft.appointment.appointmentId, reason: draft.reason });
          if (!result.success) return result;
          draft.result = result.data; draft.completed = true;
            this.completedActions.push({ id: draft.id, turnId: ctx.turnId, kind: draft.kind, result: result.data }); this.grants.delete(result.data.appointmentId);
          if (!ctx.signal.aborted && ctx.turnId === this.turn) this.cancelled();
          return ok({ outcome: "cancelled" as const, cancellation: result.data });
        })),
    ]);
  }
  private readback(draft: Draft) {
    draft.heard = false; draft.authorizedTurn = undefined;
    this.say(lang => draft.kind === "booking" ? ({
      as: `${draft.doctorName}, ${spokenDate(draft.slot.slotDate, lang)}, ${spokenTime(draft.slot.startTime, lang)}, ${draft.timezone}। ৰোগী ${draft.input.patientName}, বয়স ${draft.input.patientAge}, ফোন ${formatPhoneNumberForSpeech(this.phone)}। এপইণ্টমেণ্ট বুক কৰিমনে?`,
      hi: `${draft.doctorName}, ${spokenDate(draft.slot.slotDate, lang)}, ${spokenTime(draft.slot.startTime, lang)}, ${draft.timezone}। मरीज ${draft.input.patientName}, उम्र ${draft.input.patientAge}, फोन ${this.phone.split("").join(" ")}। क्या बुक करूँ?`,
      en: `${draft.doctorName}, ${spokenDate(draft.slot.slotDate, lang)} at ${spokenTime(draft.slot.startTime, lang)} (${draft.timezone}). Patient ${draft.input.patientName}, age ${draft.input.patientAge}, phone ${this.phone.split("").join(" ")}. Shall I book this appointment?`,
    })[lang] : ({ as: `${spokenDate(draft.appointment.appointmentDate, lang)}, ${spokenTime(draft.appointment.appointmentTime, lang)}, ${draft.appointment.doctorName}, টোকেন ${draft.appointment.tokenNumber}। এই এপইণ্টমেণ্ট বাতিল কৰিমনে?`,
      hi: `${spokenDate(draft.appointment.appointmentDate, lang)}, ${spokenTime(draft.appointment.appointmentTime, lang)}, ${draft.appointment.doctorName}, टोकन ${draft.appointment.tokenNumber}। क्या इसे रद्द करूँ?`,
      en: `Cancel token ${draft.appointment.tokenNumber} with ${draft.appointment.doctorName} on ${spokenDate(draft.appointment.appointmentDate, lang)} at ${spokenTime(draft.appointment.appointmentTime, lang)}?` })[lang], "action");
    this.actionReadback = this.reply!.text(this.language);
  }
  private booked(appointment: AppointmentSummary) {
    this.say(lang => ({ as: `আপোনাৰ এপইণ্টমেণ্ট বুক হ'ল। টোকেন নম্বৰ ${appointment.tokenNumber}। তাৰিখ ${spokenDate(appointment.appointmentDate, lang)}, সময় ${spokenTime(appointment.appointmentTime, lang)}।`,
      hi: `आपकी अपॉइंटमेंट बुक हो गई। टोकन ${appointment.tokenNumber}। तारीख ${spokenDate(appointment.appointmentDate, lang)}, समय ${spokenTime(appointment.appointmentTime, lang)}।`,
      en: `Your appointment is booked. Token ${appointment.tokenNumber}, on ${spokenDate(appointment.appointmentDate, lang)} at ${spokenTime(appointment.appointmentTime, lang)}.` })[lang]);
  }
  private cancelled() { this.say(lang => ({ as: "আপোনাৰ এপইণ্টমেণ্ট বাতিল কৰা হ'ল।", hi: "आपकी अपॉइंटमेंट रद्द कर दी गई है।", en: "Your appointment has been cancelled." })[lang]); }
}
