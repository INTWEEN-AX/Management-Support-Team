# 2026-08-25 디자인 교체 — 되돌리는 법

"종이(paper)" 테마 → shadcn/zinc(ShelfAlign Backoffice) 테마로 교체했습니다.

## Stylesheet.html

이 폴더의 `Stylesheet.html` 전체를 Apps Script 의 `Stylesheet.html` 에 붙여넣으면 끝입니다.

## JavaScript.html

교체 시 바뀐 곳은 아래 5개뿐입니다. 전체 파일을 따로 두는 대신, 되돌릴 지점만
기록합니다 (그 사이 다른 수정이 있어도 이 방식이 안전합니다).

| # | 현재 (zinc) | 되돌릴 값 (paper) |
|---|---|---|
| 1 | 상단 `CHART_FONT / CHART_GRID / CHART_TICK / CHART_SURFACE` 상수 블록 | 상수 없음 — 값이 각 차트 옵션에 직접 박혀 있었음 |
| 2 | `family: CHART_FONT` (6곳) | `family: 'Pretendard'` |
| 3 | 도넛 `borderWidth: 2, borderColor: CHART_SURFACE` | `borderWidth: 0` |
| 4 | 막대 `borderRadius: 4`, `grid: { color: CHART_GRID }`, ticks `color: CHART_TICK`, `border` 설정 | `borderRadius: 3`, `grid: { color: '#E2DED3' }`, ticks 색 지정 없음, `border` 설정 없음 |
| 5 | `switch` 의 `default:` 절에 블록 `{}` | 블록 없이 `const yearDiff` 노출 |

**5번은 되돌리지 마세요.** 디자인과 무관한 버그 예방 수정입니다. 정렬 옵션을
추가할 때 TDZ 오류가 날 자리였습니다.

## Index.html

변경 없음. 두 테마 모두 같은 클래스 이름을 씁니다.

## 색상 팔레트 주의

새 테마의 `--field-*` 는 색각이상 검증을 통과한 순서로 배치돼 있습니다
(인접쌍 ΔE 9.1 / 일반시야 19.6). 옛 팔레트는 검증 전 값입니다.
되돌리면 이 안전성도 함께 사라집니다.
