import Link from "next/link";
import { ArrowRight, ClipboardList, Bus, Wallet } from "lucide-react";
import { adminHref } from "@/lib/events/route";

export function DashboardWorkflows({ eventId }: { readonly eventId: string }) {
  const tasks = [
    { label: "명단·참여 정보 점검", detail: "신청자, 부분 참석, 이동수단을 확인하세요.", path: "/registrations", icon: ClipboardList },
    { label: "호차·탑승자 확인", detail: "배정된 호차와 상·하행 탑승자를 보세요.", path: "/buses", icon: Bus },
    { label: "차량비 정산", detail: "개인 납부, 캠퍼스 송금, 총단 수령을 비교하세요.", path: "/payments", icon: Wallet },
  ];
  return (
    <section aria-labelledby="workflow-title" className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 md:p-5">
      <h3 id="workflow-title" className="font-semibold text-foreground">자주 하는 업무</h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {tasks.map((task) => <Link key={task.path} href={adminHref(eventId, task.path)} className="group flex min-h-24 items-start gap-3 rounded-lg border border-border bg-surface p-4 transition hover:border-primary-300">
          <task.icon size={20} className="mt-0.5 shrink-0 text-primary-800" aria-hidden="true" />
          <div><p className="text-sm font-semibold text-primary-800">{task.label}</p><p className="mt-1 text-xs leading-relaxed text-muted">{task.detail}</p></div>
          <ArrowRight size={16} className="ml-auto mt-1 shrink-0 text-primary-800" aria-hidden="true" />
        </Link>)}
      </div>
    </section>
  );
}
