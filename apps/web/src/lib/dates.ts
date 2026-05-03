import { toPersianDigits } from '@saziqo/persian-utils';
import * as jalaali from 'jalaali-js';


function toDate(d: Date | string): Date {
  return typeof d === 'string' ? new Date(d) : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatJalaliFull(date: Date | string): string {
  const d = toDate(date);
  const { jy, jm, jd } = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const timeStr = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return toPersianDigits(`${jy}/${pad2(jm)}/${pad2(jd)} ${timeStr}`);
}

export function formatJalaliRelative(date: Date | string): string {
  const d = toDate(date);
  const diffMs = Date.now() - d.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return 'همین الان';
  if (diffMinutes < 60) return `${toPersianDigits(String(diffMinutes))} دقیقه پیش`;
  if (diffHours < 24) return `${toPersianDigits(String(diffHours))} ساعت پیش`;
  if (diffDays === 1) return 'دیروز';
  return formatJalaliFull(date);
}
