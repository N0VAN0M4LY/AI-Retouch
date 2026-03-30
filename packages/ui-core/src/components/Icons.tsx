import React from 'react';

interface IconProps {
  color?: string;
  size?: number;
}

const C = 'var(--text3)';

type SP = { fill: string; stroke: string; strokeWidth: number; strokeLinecap: 'round'; strokeLinejoin: 'round' };

function sp(color: string): SP {
  return { fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
}

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">{children}</svg>;
}

export const Chat = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>
);

export const Zap = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}><polygon {...sp(color)} points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Svg>
);

export const Box = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path {...sp(color)} d="m3.3 7 8.7 5 8.7-5" />
    <path {...sp(color)} d="M12 22V12" />
  </Svg>
);

export const Settings = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle {...sp(color)} cx="12" cy="12" r="3" />
  </Svg>
);

export const Plus = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M5 12h14" /><path {...sp(color)} d="M12 5v14" /></Svg>
);

export const ChevronDown = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m6 9 6 6 6-6" /></Svg>
);

export const ChevronUp = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m18 15-6-6-6 6" /></Svg>
);

export const ChevronLeft = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m15 18-6-6 6-6" /></Svg>
);

export const ChevronRight = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m9 18 6-6-6-6" /></Svg>
);

export const Palette = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <circle cx="13.5" cy="6.5" r=".5" fill={color} stroke="none" strokeWidth={0} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="17.5" cy="10.5" r=".5" fill={color} stroke="none" strokeWidth={0} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8.5" cy="7.5" r=".5" fill={color} stroke="none" strokeWidth={0} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="6.5" cy="12.5" r=".5" fill={color} stroke="none" strokeWidth={0} strokeLinecap="round" strokeLinejoin="round" />
    <path {...sp(color)} d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </Svg>
);

export const Bot = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M12 8V4H8" />
    <rect {...sp(color)} width="16" height="12" x="4" y="8" rx="2" />
    <path {...sp(color)} d="M2 14h2" /><path {...sp(color)} d="M20 14h2" />
    <path {...sp(color)} d="M15 13v2" /><path {...sp(color)} d="M9 13v2" />
  </Svg>
);

export const Search = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><circle {...sp(color)} cx="11" cy="11" r="8" /><path {...sp(color)} d="m21 21-4.3-4.3" /></Svg>
);

export const Star = ({ color = C, size = 12 }: IconProps) => (
  <Svg size={size}><polygon {...sp(color)} points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Svg>
);

export const Check = ({ color = C, size = 12 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M20 6 9 17l-5-5" /></Svg>
);

export const Trash = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M3 6h18" /><path {...sp(color)} d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path {...sp(color)} d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></Svg>
);

export const Eye = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle {...sp(color)} cx="12" cy="12" r="3" /></Svg>
);

export const EyeOff = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path {...sp(color)} d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path {...sp(color)} d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line {...sp(color)} x1="2" x2="22" y1="2" y2="22" />
  </Svg>
);

export const Save = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path {...sp(color)} d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
    <path {...sp(color)} d="M7 3v4a1 1 0 0 0 1 1h7" />
  </Svg>
);

export const ArrowLeft = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m12 19-7-7 7-7" /><path {...sp(color)} d="M19 12H5" /></Svg>
);

export const Dot = ({ color }: { color: string }) => (
  <svg width={8} height={8} viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="4" r="4" fill={color} stroke="none" strokeWidth={0} /></svg>
);

export const Globe = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><circle {...sp(color)} cx="12" cy="12" r="10" /><path {...sp(color)} d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path {...sp(color)} d="M2 12h20" /></Svg>
);

export const Key = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" /><path {...sp(color)} d="m21 2-9.6 9.6" /><circle {...sp(color)} cx="7.5" cy="15.5" r="5.5" /></Svg>
);

export const Cpu = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <rect {...sp(color)} width="16" height="16" x="4" y="4" rx="2" /><rect {...sp(color)} width="6" height="6" x="9" y="9" rx="1" />
    <path {...sp(color)} d="M15 2v2" /><path {...sp(color)} d="M15 20v2" /><path {...sp(color)} d="M2 15h2" /><path {...sp(color)} d="M2 9h2" />
    <path {...sp(color)} d="M20 15h2" /><path {...sp(color)} d="M20 9h2" /><path {...sp(color)} d="M9 2v2" /><path {...sp(color)} d="M9 20v2" />
  </Svg>
);

export const ToggleLeft = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><rect {...sp(color)} width="20" height="12" x="2" y="6" rx="6" ry="6" /><circle {...sp(color)} cx="8" cy="12" r="2" /></Svg>
);

export const ToggleRight = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><rect {...sp(color)} width="20" height="12" x="2" y="6" rx="6" ry="6" /><circle {...sp(color)} cx="16" cy="12" r="2" /></Svg>
);

export const Send = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m22 2-7 20-4-9-9-4Z" /><path {...sp(color)} d="M22 2 11 13" /></Svg>
);

export const Image = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}><rect {...sp(color)} width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle {...sp(color)} cx="9" cy="9" r="2" /><path {...sp(color)} d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></Svg>
);

export const X = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M18 6 6 18" /><path {...sp(color)} d="m6 6 12 12" /></Svg>
);

export const Loader = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M12 2v4" /><path {...sp(color)} d="m16.2 7.8 2.9-2.9" /><path {...sp(color)} d="M18 12h4" /><path {...sp(color)} d="m16.2 16.2 2.9 2.9" />
    <path {...sp(color)} d="M12 18v4" /><path {...sp(color)} d="m4.9 19.1 2.9-2.9" /><path {...sp(color)} d="M2 12h4" /><path {...sp(color)} d="m4.9 4.9 2.9 2.9" />
  </Svg>
);

export const Download = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline {...sp(color)} points="7 10 12 15 17 10" /><line {...sp(color)} x1="12" x2="12" y1="15" y2="3" /></Svg>
);

export const Pencil = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path {...sp(color)} d="m15 5 4 4" /></Svg>
);

export const SlidersHorizontal = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <line {...sp(color)} x1="21" x2="14" y1="4" y2="4" /><line {...sp(color)} x1="10" x2="3" y1="4" y2="4" />
    <line {...sp(color)} x1="21" x2="12" y1="12" y2="12" /><line {...sp(color)} x1="8" x2="3" y1="12" y2="12" />
    <line {...sp(color)} x1="21" x2="16" y1="20" y2="20" /><line {...sp(color)} x1="12" x2="3" y1="20" y2="20" />
    <line {...sp(color)} x1="14" x2="14" y1="2" y2="6" /><line {...sp(color)} x1="8" x2="8" y1="10" y2="14" /><line {...sp(color)} x1="16" x2="16" y1="18" y2="22" />
  </Svg>
);

export const Square = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
);

export const AlertCircle = ({ color = C, size = 16 }: IconProps) => (
  <Svg size={size}><circle {...sp(color)} cx="12" cy="12" r="10" /><line {...sp(color)} x1="12" x2="12" y1="8" y2="12" /><line {...sp(color)} x1="12" x2="12.01" y1="16" y2="16" /></Svg>
);

export const Crop = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M6 2v14a2 2 0 0 0 2 2h14" /><path {...sp(color)} d="M18 22V8a2 2 0 0 0-2-2H2" /></Svg>
);

export const Scan = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M3 7V5a2 2 0 0 1 2-2h2" /><path {...sp(color)} d="M17 3h2a2 2 0 0 1 2 2v2" /><path {...sp(color)} d="M21 17v2a2 2 0 0 1-2 2h-2" /><path {...sp(color)} d="M7 21H5a2 2 0 0 1-2-2v-2" /></Svg>
);

export const CircleDashed = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0" /><path {...sp(color)} d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7" />
    <path {...sp(color)} d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8" /><path {...sp(color)} d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69" />
    <path {...sp(color)} d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0" /><path {...sp(color)} d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7" />
    <path {...sp(color)} d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8" /><path {...sp(color)} d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69" />
  </Svg>
);

export const Layers = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path {...sp(color)} d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path {...sp(color)} d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </Svg>
);

export const RefreshCw = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path {...sp(color)} d="M21 3v5h-5" />
    <path {...sp(color)} d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path {...sp(color)} d="M3 21v-5h5" />
  </Svg>
);

export const Maximize = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M8 3H5a2 2 0 0 0-2 2v3" /><path {...sp(color)} d="M21 8V5a2 2 0 0 0-2-2h-3" /><path {...sp(color)} d="M3 16v3a2 2 0 0 0 2 2h3" /><path {...sp(color)} d="M16 21h3a2 2 0 0 0 2-2v-3" /></Svg>
);

export const Minimize = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M8 3v3a2 2 0 0 1-2 2H3" /><path {...sp(color)} d="M21 8h-3a2 2 0 0 1-2-2V3" /><path {...sp(color)} d="M3 16h3a2 2 0 0 1 2 2v3" /><path {...sp(color)} d="M16 21v-3a2 2 0 0 1 2-2h3" /></Svg>
);

export const Crosshair = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><circle cx="12" cy="12" r="10" {...sp(color)} /><line x1="22" y1="12" x2="18" y2="12" {...sp(color)} /><line x1="6" y1="12" x2="2" y2="12" {...sp(color)} /><line x1="12" y1="6" x2="12" y2="2" {...sp(color)} /><line x1="12" y1="22" x2="12" y2="18" {...sp(color)} /></Svg>
);

export const Lock = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" {...sp(color)} /><path {...sp(color)} d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>
);

export const Upload = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline {...sp(color)} points="17 8 12 3 7 8" /><line {...sp(color)} x1="12" x2="12" y1="3" y2="15" /></Svg>
);

export const FolderOpen = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></Svg>
);

export const Minus = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}><path {...sp(color)} d="M5 12h14" /></Svg>
);

export const GripVertical = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <circle cx="9" cy="12" r="1" fill={color} /><circle cx="9" cy="5" r="1" fill={color} /><circle cx="9" cy="19" r="1" fill={color} />
    <circle cx="15" cy="12" r="1" fill={color} /><circle cx="15" cy="5" r="1" fill={color} /><circle cx="15" cy="19" r="1" fill={color} />
  </Svg>
);

export const FileJson = ({ color = C, size = 14 }: IconProps) => (
  <Svg size={size}>
    <path {...sp(color)} d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path {...sp(color)} d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path {...sp(color)} d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />
    <path {...sp(color)} d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />
  </Svg>
);
