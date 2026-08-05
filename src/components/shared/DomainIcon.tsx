import type { ComponentType, ReactNode, SVGProps } from 'react'

type DomainIconProps = SVGProps<SVGSVGElement> & {
  size?: number
}

function IconFrame({ size = 18, children, ...props }: DomainIconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

export const ContainersIcon: ComponentType<DomainIconProps> = ({ size = 18, ...props }) => (
  <IconFrame size={size} {...props}>
    <path d="m3 7 8.5-4L21 7v8.5L12 20l-9-4.5V7Z" />
    <path d="m3 7 9 4.5L21 7M12 11.5V20M6.5 5.3v9.6M17.5 5.3v9.6" />
    <path d="m7.2 15.2 2.1-1.1 2.1 1.1-2.1 1.1-2.1-1.1ZM13 15.2l2.1-1.1 2.1 1.1-2.1 1.1-2.1-1.1Z" />
  </IconFrame>
)

export const VaziosImpIcon: ComponentType<DomainIconProps> = ({ size = 18, ...props }) => (
  <IconFrame size={size} {...props}>
    <path d="M3.5 17.5h17M5 17.5V7l2-1.5h2v12M19 17.5V7l-2-1.5h-2v12" />
    <path d="M5 7h14M7 10h10M7 13h10M7 16h10" />
    <path d="M3.5 17.5 5 20h14l1.5-2.5" />
  </IconFrame>
)

export const VaziosExpIcon: ComponentType<DomainIconProps> = ({ size = 18, ...props }) => (
  <IconFrame size={size} {...props}>
    <path d="M4 5.5h16v13H4z" />
    <path d="M7 5.5v13M10 5.5v13M13 5.5v13M16 5.5v13M4 8.5h16M4 15.5h16" />
    <path d="M2.5 5.5h1.5M20 5.5h1.5M2.5 18.5h1.5M20 18.5h1.5" />
  </IconFrame>
)
