import type { ComponentType, ImgHTMLAttributes } from 'react'
import containersIcon from '../../assets/icons/containers.png'
import vaziosImpIcon from '../../assets/icons/vazios-imp.png'
import vaziosExpIcon from '../../assets/icons/vazios-exp.png'

type DomainIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  size?: number
  alt?: string
}

function createDomainIcon(src: string, defaultAlt: string): ComponentType<DomainIconProps> {
  return function DomainIcon({ size = 18, alt = defaultAlt, className, ...props }: DomainIconProps) {
    return <img src={src} alt={alt} width={size} height={size} className={`object-contain ${className ?? ''}`} {...props} />
  }
}

export const ContainersIcon = createDomainIcon(containersIcon, 'Containers')
export const VaziosImpIcon = createDomainIcon(vaziosImpIcon, 'Vazios IMP')
export const VaziosExpIcon = createDomainIcon(vaziosExpIcon, 'Vazios EXP')
