import type { SVGProps } from 'react'

export type IconName =
  | 'activity'
  | 'agent'
  | 'artifact'
  | 'chevronLeft'
  | 'chevronRight'
  | 'close'
  | 'download'
  | 'folder'
  | 'grid'
  | 'home'
  | 'logout'
  | 'menu'
  | 'newChat'
  | 'panelRight'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'shield'
  | 'team'
  | 'users'

const paths: Record<IconName, React.ReactNode> = {
  activity: <><path d="M4 17V9" /><path d="M10 17V5" /><path d="M16 17v-6" /><path d="M2 19h16" /></>,
  agent: <><path d="M5 5.5h10v9H5z" /><path d="M8 3.5h4" /><circle cx="8" cy="9" r="1" /><circle cx="12" cy="9" r="1" /><path d="M8 12h4M3 8v4M17 8v4" /></>,
  artifact: <><path d="M5 2.75h6l4 4V17.25H5z" /><path d="M11 2.75v4h4" /><path d="M7.75 11h4.5M7.75 14h4.5" /></>,
  chevronLeft: <path d="m12.5 5-5 5 5 5" />,
  chevronRight: <path d="m7.5 5 5 5-5 5" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  download: <><path d="M10 3v10" /><path d="m6.5 9.5 3.5 3.5 3.5-3.5" /><path d="M4 16.5h12" /></>,
  folder: <><path d="M2.75 5.5h5l1.5 1.75h8v8.25H2.75z" /><path d="M2.75 7.25V4.5h4.5l1.5 1" /></>,
  grid: <><rect x="3.25" y="3.25" width="5.5" height="5.5" rx="1" /><rect x="11.25" y="3.25" width="5.5" height="5.5" rx="1" /><rect x="3.25" y="11.25" width="5.5" height="5.5" rx="1" /><rect x="11.25" y="11.25" width="5.5" height="5.5" rx="1" /></>,
  home: <><path d="m3.25 9 6.75-5.5L16.75 9" /><path d="M5.25 8v8h9.5V8M8.25 16v-5h3.5v5" /></>,
  logout: <><path d="M8 4H4.5v12H8" /><path d="M11 7l3 3-3 3M14 10H7" /></>,
  menu: <><path d="M4 6h12M4 10h12M4 14h12" /></>,
  newChat: <><path d="M4 4h9v9H7l-3 3z" /><path d="M13 3v4M11 5h4" /></>,
  panelRight: <><rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2" /><path d="M12.25 3.25v13.5" /></>,
  plus: <path d="M10 3.5v13M3.5 10h13" />,
  refresh: <><path d="M15.5 7A6 6 0 1 0 16 12" /><path d="M12.5 4.5h3v3" /></>,
  search: <><circle cx="8.5" cy="8.5" r="4.75" /><path d="m12 12 4 4" /></>,
  shield: <><path d="M10 2.75 16 5v4.5c0 3.6-2.35 6.15-6 7.75-3.65-1.6-6-4.15-6-7.75V5z" /><path d="m7.5 10 1.6 1.6 3.5-3.5" /></>,
  team: <><circle cx="7" cy="7" r="2.25" /><circle cx="13.5" cy="7.75" r="1.75" /><path d="M2.75 16c.35-3 1.75-4.5 4.25-4.5s3.9 1.5 4.25 4.5" /><path d="M12 12.25c2.9-.45 4.65.8 5 3.25" /></>,
  users: <><circle cx="7" cy="7" r="2.5" /><path d="M2.75 16c.35-3 1.75-4.5 4.25-4.5s3.9 1.5 4.25 4.5" /><circle cx="14.5" cy="7.75" r="1.75" /><path d="M13.25 12.25c2.45-.3 3.75.95 4 3.25" /></>,
}

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 20 20"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.55"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
