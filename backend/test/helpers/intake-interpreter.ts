import { createIntakeInterpreter, type IntakeInput } from "../../src/components/clinic/voice/intake.js";
import { ScriptedProvider } from "./scripted-provider.js";

/** Synthetic semantic response, kept out of production code. Real SDK still validates it. */
export const fixtureIntakeInterpreter = createIntakeInterpreter(new ScriptedProvider(messages => {
  const input = JSON.parse(messages[0]!.content) as IntakeInput;
  const name = /নাম (.*?), বয়স/u.exec(input.text)?.[1];
  const age = /বয়স (\d+)/u.exec(input.text)?.[1];
  return [{ type: "text", delta: JSON.stringify({ intent: "provide_details",
    name: name ? { quote: name, sourceTurn: input.turnId } : null,
    age: age ? { value: Number(age), evidence: age, sourceTurn: input.turnId } : null,
    nextField: input.phoneConfirmed ? "ready" : "phone", reply: input.phoneConfirmed ? "The details can now be reviewed before booking." : "What phone number should we use?" }) }, { type: "done" }];
}));
