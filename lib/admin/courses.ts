"use client";

import { createClient } from "@/lib/supabase/client";
import { currentEventId } from "@/lib/events/current";

// 순수 계산(eventDayCount·dayLabel)은 `lib/courses/days` 에 있다 —
// 이 파일은 "use client" 라 서버 컴포넌트가 여기서 못 가져간다.

type Result = { ok: true } | { ok: false; message: string };

/**
 * 수강신청 조사 (동규님 요청, 2026-07-31).
 *
 * **날짜를 저장하지 않는다.** 저장하는 건 `day_no`(1=첫째날) 뿐이다 —
 * "리더십 캠프 날짜가 계속 변하잖아" 가 그 이유다. 실제 날짜는 행사 시작일에서
 * 계산해 보여주므로, 다음 행사에서 손댈 것이 없다.
 *
 * 해당 없는 사람은 **행이 아예 없다.** "안 들음" 을 값으로 저장하지 않는다 —
 * 그러면 아직 안 고른 것과 구분되지 않는다.
 */

/** 그 사람의 그 날 수강신청을 켠다. 이미 있으면 시간만 고친다. */
export async function setCourseSignup(
  registrationId: string,
  dayNo: number,
  /** `HH:MM`. 비우면 "시간 미정" — 보드에서 맨 위에 모인다. */
  atTime: string | null
): Promise<Result> {
  const supabase = createClient();
  const ev = await currentEventId(supabase);
  if (!ev.ok) return ev;

  // 있으면 고치고 없으면 넣는다. upsert 를 쓰지 않는 이유는 이 테이블의 유니크가
  // (registration_id, day_no) 라서 onConflict 문자열을 손으로 맞춰야 하고,
  // 그 문자열이 틀려도 **조용히 새 행이 생기기** 때문이다.
  const { data: existing } = await supabase
    .from("course_signups")
    .select("id")
    .eq("registration_id", registrationId)
    .eq("day_no", dayNo)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("course_signups")
      .update({ at_time: atTime || null })
      .eq("id", existing.id);
    if (error) return { ok: false, message: humanize(error.message) };
    return { ok: true };
  }

  const { error } = await supabase.from("course_signups").insert({
    event_id: ev.id,
    registration_id: registrationId,
    day_no: dayNo,
    at_time: atTime || null,
  });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 그 날 수강신청을 끈다 — 행을 지운다("안 들음"을 값으로 남기지 않는다). */
export async function clearCourseSignup(
  registrationId: string,
  dayNo: number
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("course_signups")
    .delete()
    .eq("registration_id", registrationId)
    .eq("day_no", dayNo);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("uq_course_signups_reg_day"))
    return "이 사람은 그 날 수강신청이 이미 있습니다.";
  if (msg.includes("course_signups_day_no_check"))
    return "행사 기간 안의 날짜만 고를 수 있습니다.";
  if (msg.includes("다른 행사의 신청")) return msg;
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다 (본인 캠퍼스만 고칠 수 있어요).";
  if (msg.includes("지난 행사")) return msg;
  return msg;
}
