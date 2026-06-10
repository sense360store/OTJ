// Inline SVG icon set, stroke based. Ported from the prototype icons.js.
// Each icon is a small functional component accepting standard SVG props plus
// an optional numeric size. Exported as one Icon map, so the fast refresh
// component-only rule is relaxed here.
/* eslint-disable react-refresh/only-export-components */
import { createElement } from 'react'
import type { ComponentType, SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }
export type IconComponent = ComponentType<IconProps>

type Shape = { t: string; p: Record<string, number | string> }
type PathDef = string | Shape

const S =
  (paths: PathDef[], extra: Record<string, unknown> = {}): IconComponent =>
  (props: IconProps) => {
    const { size, ...rest } = props ?? {}
    return createElement(
      'svg',
      {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        width: size,
        height: size,
        ...extra,
        ...rest,
      },
      paths.map((d, i) =>
        typeof d === 'string'
          ? createElement('path', { key: i, d })
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            createElement(d.t as any, { key: i, ...d.p }),
      ),
    )
  }

const C = (cx: number, cy: number, r: number): Shape => ({ t: 'circle', p: { cx, cy, r } })
const L = (x1: number, y1: number, x2: number, y2: number): Shape => ({ t: 'line', p: { x1, y1, x2, y2 } })
const R = (x: number, y: number, w: number, h: number, rx: number): Shape => ({
  t: 'rect',
  p: { x, y, width: w, height: h, rx },
})

export const Icon = {
  home: S(['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M9.5 21v-6h5v6']),
  grid: S([R(3, 3, 7, 7, 1.5), R(14, 3, 7, 7, 1.5), R(3, 14, 7, 7, 1.5), R(14, 14, 7, 7, 1.5)]),
  calendar: S([R(3, 4.5, 18, 17, 2.5), L(3, 9, 21, 9), L(8, 2.5, 8, 6.5), L(16, 2.5, 16, 6.5)]),
  layers: S(['M12 3 3 8l9 5 9-5-9-5Z', 'M3 13l9 5 9-5', 'M3 8v5', 'M21 8v5']),
  film: S([
    R(3, 4, 18, 16, 3),
    L(8, 4, 8, 20),
    L(16, 4, 16, 20),
    L(3, 9.3, 8, 9.3),
    L(16, 9.3, 21, 9.3),
    L(3, 14.7, 8, 14.7),
    L(16, 14.7, 21, 14.7),
  ]),
  book: S(['M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z', 'M4 19a2 2 0 0 1 2-2h13']),
  whistle: S([C(8, 14, 6), 'M14 11l7-3v4l-5 2', 'M8 14h.01', 'M8 8V5h4']),
  play: S([{ t: 'polygon', p: { points: '7 4 20 12 7 20 7 4', fill: 'currentColor', stroke: 'none' } }]),
  pause: S([R(7, 5, 3.5, 14, 1), R(13.5, 5, 3.5, 14, 1)]),
  skipFwd: S([{ t: 'polygon', p: { points: '6 4 15 12 6 20 6 4', fill: 'currentColor', stroke: 'none' } }, R(17, 4, 2.5, 16, 1)]),
  skipBack: S([{ t: 'polygon', p: { points: '18 4 9 12 18 20 18 4', fill: 'currentColor', stroke: 'none' } }, R(4.5, 4, 2.5, 16, 1)]),
  plus: S([L(12, 5, 12, 19), L(5, 12, 19, 12)]),
  search: S([C(11, 11, 7), L(16.5, 16.5, 21, 21)]),
  clock: S([C(12, 12, 9), 'M12 7.5V12l3 2']),
  users: S([C(9, 8, 3.5), 'M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5', 'M16 4.5a3.3 3.3 0 0 1 0 6.4', 'M18 14.5c2 .6 3 2.2 3 4.5']),
  user: S([C(12, 8, 4), 'M5 20c0-3.6 3-6 7-6s7 2.4 7 6']),
  pin: S(['M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z', C(12, 10, 2.5)]),
  target: S([C(12, 12, 9), C(12, 12, 5), C(12, 12, 1.3)]),
  ruler: S(['M3 15 15 3l6 6L9 21Z', 'M6.5 11.5l2 2', 'M9.5 8.5l2 2', 'M12.5 5.5l2 2']),
  cone: S(['M9.5 4h5l3.5 16H6Z', 'M7.2 13h9.6', 'M8.3 8.5h7.4']),
  flag: S(['M5 21V4', 'M5 4h11l-2 4 2 4H5']),
  check: S(['M4 12.5 9.5 18 20 6.5']),
  checkCircle: S([C(12, 12, 9), 'M8.5 12.5 11 15l4.5-5']),
  x: S([L(6, 6, 18, 18), L(18, 6, 6, 18)]),
  chevL: S(['M15 5l-7 7 7 7']),
  chevR: S(['M9 5l7 7-7 7']),
  chevDown: S(['M5 9l7 7 7-7']),
  arrowRight: S([L(4, 12, 20, 12), 'M14 6l6 6-6 6']),
  sun: S([
    C(12, 12, 4.5),
    L(12, 2, 12, 4),
    L(12, 20, 12, 22),
    L(2, 12, 4, 12),
    L(20, 12, 22, 12),
    L(4.9, 4.9, 6.3, 6.3),
    L(17.7, 17.7, 19.1, 19.1),
    L(4.9, 19.1, 6.3, 17.7),
    L(17.7, 6.3, 19.1, 4.9),
  ]),
  moon: S(['M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z']),
  sidebar: S([R(3, 4, 18, 16, 2.5), L(9, 4, 9, 20)]),
  upload: S(['M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3', 'M12 4v11', 'M7.5 8.5 12 4l4.5 4.5']),
  image: S([R(3, 4, 18, 16, 2.5), C(8.5, 9.5, 1.8), 'M21 16l-5-5L5 20']),
  video: S([R(3, 6, 12, 12, 2.5), 'M15 10l6-3v10l-6-3']),
  fileText: S(['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4']),
  youtube: S([R(3, 6, 18, 12, 4), { t: 'polygon', p: { points: '11 9 15 12 11 15 11 9', fill: 'currentColor', stroke: 'none' } }]),
  lock: S([R(4.5, 10.5, 15, 10, 2.5), 'M8 10.5V7.5a4 4 0 0 1 8 0v3']),
  logout: S(['M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3', 'M15 8l4 4-4 4', 'M19 12H9']),
  edit: S(['M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.2Z', 'M14 6.5l3 3']),
  trash: S(['M4 7h16', 'M9 7V4.5h6V7', 'M6 7l1 13h10l1-13']),
  grip: S([C(8, 6, 1), C(8, 12, 1), C(8, 18, 1), C(16, 6, 1), C(16, 12, 1), C(16, 18, 1)]),
  note: S(['M5 4h10l4 4v12H5Z', 'M15 4v4h4', 'M8 12h8', 'M8 16h5']),
  sparkle: S(['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z']),
  list: S([L(8, 6, 21, 6), L(8, 12, 21, 12), L(8, 18, 21, 18), C(4, 6, 0.6), C(4, 12, 0.6), C(4, 18, 0.6)]),
  filter: S(['M3 5h18l-7 8v6l-4-2v-4Z']),
  dumbbell: S([L(6, 8, 6, 16), L(4, 9, 4, 15), L(18, 8, 18, 16), L(20, 9, 20, 15), L(6, 12, 18, 12)]),
  brain: S([
    'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 2 4 3 3 0 0 0 4 1V4Z',
    'M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-2 4 3 3 0 0 1-4 1V4Z',
  ]),
  handshake: S(['M8 12l3-3 2 2 3-3', 'M3 9l4-4 5 5', 'M21 9l-4-4-3 3', 'M3 9v4l5 5 2-2', 'M21 9v4l-5 5-2-2']),
  bolt: S(['M13 3 4 14h6l-1 7 9-11h-6Z']),
  rotate: S(['M3 12a9 9 0 1 1 3 6.7', 'M3 20v-4h4']),
  download: S(['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M4 19h16']),
  eye: S(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', C(12, 12, 3)]),
  star: S(['M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7Z']),
  external: S(['M14 4h6v6', 'M20 4l-9 9', 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4']),
  copy: S([R(8, 8, 12, 12, 2.5), 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2']),
  bell: S(['M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6', 'M10 20a2 2 0 0 0 4 0']),
} satisfies Record<string, IconComponent>
