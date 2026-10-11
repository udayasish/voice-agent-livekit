/**
 * Error hierarchy for Raya BakBak TTS provider operations.
 */

export class RayaError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "RayaError";
  }
}

export class RayaConfigurationError extends RayaError {
  constructor(message: string) {
    super(message, "RAYA_CONFIG_ERROR");
    this.name = "RayaConfigurationError";
  }
}

export class RayaAuthenticationError extends RayaError {
  constructor(message = "Invalid or missing Raya API key. Provide RAYA_API_KEY environment variable.") {
    super(message, "RAYA_AUTH_ERROR");
    this.name = "RayaAuthenticationError";
  }
}

export class RayaVoiceNotFoundError extends RayaError {
  constructor(voiceId: string, model: string, language: string) {
    super(
      `Voice ID "${voiceId}" not found for model "${model}" and language "${language}" in Raya catalog`,
      "RAYA_VOICE_NOT_FOUND",
    );
    this.name = "RayaVoiceNotFoundError";
  }
}

export class RayaProtocolError extends RayaError {
  constructor(message: string, public readonly statusCode?: number | undefined) {
    super(message, "RAYA_PROTOCOL_ERROR");
    this.name = "RayaProtocolError";
  }
}

export class RayaAudioDecodeError extends RayaError {
  constructor(message: string) {
    super(message, "RAYA_AUDIO_DECODE_ERROR");
    this.name = "RayaAudioDecodeError";
  }
}

export class RayaTimeoutError extends RayaError {
  constructor(message: string) {
    super(message, "RAYA_TIMEOUT_ERROR");
    this.name = "RayaTimeoutError";
  }
}
