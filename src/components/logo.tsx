import { cn } from '@/lib/utils'
import { OlonMark } from '@/components/ui/logo/OlonMark'

export const Logo = ({ className, uniColor }: { className?: string; uniColor?: boolean }) => {
    return (
        <OlonMark
            size={32}
            variant={uniColor ? 'mono' : 'default'}
            className={cn('h-8 w-8', className)}
        />
    )
}

export const LogoIcon = ({ className, uniColor }: { className?: string; uniColor?: boolean }) => {
    return (
        <OlonMark
            size={20}
            variant={uniColor ? 'mono' : 'default'}
            className={cn('size-5', className)}
        />
    )
}