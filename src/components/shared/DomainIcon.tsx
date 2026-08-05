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
    <path d="m3.5 7 8.5-4 8.5 4v10l-8.5 4-8.5-4V7Z" />
    <path d="m3.5 7 8.5 4 8.5-4M12 11v10M7 5.5v9M17 5.5v9" />
    <path d="M8 16.5h2M14 16.5h2" />
  </IconFrame>
)

function FlatRackIcon({ size = 18, ...props }: DomainIconProps) {
  return (
    <IconFrame size={size} {...props}>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" />
      <path d="M4 7.5 12 11l8-3.5M12 11v9M7 6.2v9.5M17 6.2v9.5" />
      <path d="M8.5 15.5h7" />
    </IconFrame>
  )
}

export const VaziosImpIcon: ComponentType<DomainIconProps> = FlatRackIcon
export const VaziosExpIcon: ComponentType<DomainIconProps> = FlatRackIcon
