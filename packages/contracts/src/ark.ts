import * as Schema from "effect/Schema";

const ArkTmuxName = Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(128));

export const ArkMachine = Schema.Struct({
  id: Schema.String,
  hostname: Schema.String,
  dnsName: Schema.String,
  tailscaleIp: Schema.String,
  online: Schema.Boolean,
  os: Schema.String,
  isSelf: Schema.Boolean,
});
export type ArkMachine = typeof ArkMachine.Type;

export const ArkTmuxSession = Schema.Struct({
  name: ArkTmuxName,
  windows: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  attached: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  created: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  ark: Schema.Boolean,
  machineId: Schema.optional(Schema.String),
  machineName: Schema.optional(Schema.String),
  machineIp: Schema.optional(Schema.String),
  machineOnline: Schema.optional(Schema.Boolean),
  machineSelf: Schema.optional(Schema.Boolean),
});
export type ArkTmuxSession = typeof ArkTmuxSession.Type;

export const ArkListMachinesResult = Schema.Struct({
  machines: Schema.Array(ArkMachine),
});
export type ArkListMachinesResult = typeof ArkListMachinesResult.Type;

export const ArkListTmuxSessionsResult = Schema.Struct({
  sessions: Schema.Array(ArkTmuxSession),
});
export type ArkListTmuxSessionsResult = typeof ArkListTmuxSessionsResult.Type;

export const ArkTmuxInput = Schema.Struct({
  name: ArkTmuxName,
  machineIp: Schema.optional(Schema.String),
});
export type ArkTmuxInput = typeof ArkTmuxInput.Type;

export const ArkTmuxCaptureInput = Schema.Struct({
  name: ArkTmuxName,
  machineIp: Schema.optional(Schema.String),
  scroll: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ArkTmuxCaptureInput = typeof ArkTmuxCaptureInput.Type;

export const ArkTmuxCaptureResult = Schema.Struct({
  text: Schema.String,
});
export type ArkTmuxCaptureResult = typeof ArkTmuxCaptureResult.Type;

export const ArkTmuxSendTextInput = Schema.Struct({
  name: ArkTmuxName,
  machineIp: Schema.optional(Schema.String),
  text: Schema.String.check(Schema.isMaxLength(65_536)),
  submit: Schema.optional(Schema.Boolean),
});
export type ArkTmuxSendTextInput = typeof ArkTmuxSendTextInput.Type;

export const ArkTmuxSendKeyInput = Schema.Struct({
  name: ArkTmuxName,
  machineIp: Schema.optional(Schema.String),
  key: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(32)),
});
export type ArkTmuxSendKeyInput = typeof ArkTmuxSendKeyInput.Type;

export class ArkOperationError extends Schema.TaggedErrorClass<ArkOperationError>()(
  "ArkOperationError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}
