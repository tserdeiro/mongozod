import type { Metadata } from 'next'

import './global.css'

import { appName, siteUrl } from '@/lib/shared'
import { GoogleAnalytics } from '@next/third-parties/google'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin']
})

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${appName}: MongoDB with Zod as the single source of truth`,
    template: `%s | ${appName}`
  },
  description:
    'The Mongoose alternative built on Zod and the official MongoDB driver. One schema validates every write, types every read and defines what each endpoint accepts.'
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
      {/* Measures only where the deployment sets the ID, so local and preview builds stay out. */}
      {process.env.NEXT_PUBLIC_GA_ID && <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />}
    </html>
  )
}
