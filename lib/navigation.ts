import { adminHref } from "@/lib/events/route";
import type { NavGroup } from "@/components/ui/workspace-nav";

export function adminNavigation(eventId: string, isMaster: boolean): readonly NavGroup[] {
  const item = (label: string, path: string) => ({ label, href: adminHref(eventId, path) });
  return [
    { label: "현황", items: [item("운영 현황", "")] },
    { label: "명단·참여", items: [item("전체 명단", "/registrations"), item("부분 참석", "/partial"), item("순장·담당자", "/leaders"), item("수강신청 조사", "/courses")] },
    { label: "차량·이동", items: [item("호차·탑승자", "/buses"), item("출석 확인", "/attendance"), ...(isMaster ? [item("운행편·차량 편성", "/trips"), item("자동 배차", "/batch")] : []), item("이동수단·수송", "/transport")] },
    { label: "정산", items: [item("차량비 정산", "/payments")] },
    { label: "운영 관리", items: [...(isMaster ? [item("운영 설정", "/control"), item("사용자·권한", "/users"), item("역할 이름", "/roles")] : []), item("변경 내역", "/changes"), item("오류 점검", "/errors"), item("활동 기록", "/logs")] },
  ];
}

export const campusNavigation: readonly NavGroup[] = [
  { label: "명단·참여", items: [{ label: "순장·순원 명단", href: "/campus" }, { label: "명단 가져오기", href: "/campus/import" }, { label: "부분 참석", href: "/campus/partial" }] },
  { label: "차량·이동", items: [{ label: "배정 호차 조회", href: "/campus/buses" }, { label: "수송 요청", href: "/campus/pickup" }] },
  { label: "정산", items: [{ label: "차량비·송금", href: "/campus/payments" }] },
];
