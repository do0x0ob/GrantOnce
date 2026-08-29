import { StatusChip } from "@/components/denial-banner";
import { SURFACE } from "@/components/surface";
import type { ProtocolEvent } from "@/lib/types";

export function ProtocolInspector({ event }: { event: ProtocolEvent | null }) {
  if (!event) {
    return (
      <section className={`${SURFACE} px-5 py-4`}>
        <p className="text-[13px] leading-5 text-stone-400">協定</p>
        <p className="mt-1 text-[13px] leading-6 text-stone-400">
          越權或拿錯匣的請求會出現在這裡：Bearer、presenter、403 JSON。
        </p>
      </section>
    );
  }

  const response = event.response.ok
    ? JSON.stringify({ ok: true, status: 200, fieldIds: event.response.fieldIds }, null, 2)
    : JSON.stringify(
        {
          ok: false,
          status: event.response.status,
          code: event.response.code,
          error: event.response.error,
        },
        null,
        2,
      );

  return (
    <section className={`${SURFACE} px-5 py-4`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-[13px] leading-5 text-stone-400">協定</p>
        {event.response.ok ? (
          <StatusChip tone="mint">200</StatusChip>
        ) : (
          <StatusChip tone="rose">{String(event.response.code ?? event.response.status)}</StatusChip>
        )}
        <span className="font-mono text-[11px] text-stone-300">{event.request.path}</span>
      </div>
      <dl className="space-y-1 text-[12px] leading-5">
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="text-stone-400">Authorization</dt>
          <dd className="break-all font-mono text-stone-700">{event.request.authorization}</dd>
        </div>
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="text-stone-400">Presenter</dt>
          <dd className="font-mono text-stone-700">
            {event.request.presenter ?? "（無）"}
          </dd>
        </div>
        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
          <dt className="text-stone-400">fields</dt>
          <dd className="break-all font-mono text-stone-700">
            {event.request.fields.length > 0 ? event.request.fields.join(", ") : "—"}
          </dd>
        </div>
      </dl>
      <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-5 text-stone-600">
        {response}
      </pre>
    </section>
  );
}
