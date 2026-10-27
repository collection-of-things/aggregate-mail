import { followUpPreset } from "../../shared/follow-up-presets";

export function localScheduleTime(at: number): string {
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function ScheduleTime({ at, onChange, disabled = false }: {
  at: number; onChange: (at: number) => void; disabled?: boolean;
}) {
  return <fieldset className="schedule-time" disabled={disabled}>
    <legend>Send later</legend>
    <p>Emc² must be running and online to send. After sleep, restart or a missed offline schedule, review the saved message. There is no recall after acceptance.</p>
    <div className="schedule-presets">
      {([ ["tomorrow", "Tomorrow morning"], ["monday", "Monday morning"] ] as const).map(([preset, label]) =>
        <button type="button" key={preset} onClick={() => onChange(followUpPreset(preset, Date.now())!)}>{label}</button>)}
    </div>
    <label>Local date and time<input aria-label="Send later date and time" type="datetime-local" required
      min={localScheduleTime(Date.now() + 60000)} max={localScheduleTime(Date.now() + 366 * 86400000)} value={Number.isFinite(at) ? localScheduleTime(at) : ""}
      onInput={event => onChange(new Date(event.currentTarget.value).getTime())} /></label>
  </fieldset>;
}
