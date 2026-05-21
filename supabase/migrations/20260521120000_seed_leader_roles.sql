-- 배차 연동 특수 역할 라벨 시드: '차량 순장', '고정 탑승자'.
-- 이 역할을 가진 사람은 타는 방향(상행/하행)에 대해 호차가 반드시 지정되어야 하고,
-- 미지정 시 배차가 차단된다. (검증·UI는 코드에서 처리, 라벨 문자열은 코드 상수와 일치)
INSERT INTO role_labels (label, color, display_order)
VALUES
  ('차량 순장', 'yellow', 10),
  ('고정 탑승자', 'blue', 11)
ON CONFLICT (label) DO NOTHING;
