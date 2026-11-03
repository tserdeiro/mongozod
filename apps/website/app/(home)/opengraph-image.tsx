import { appName, siteTagline } from '@/lib/shared'
import { generateOGImage } from 'fumadocs-ui/og'

// The image of the home, made as the ones of the docs pages. The template fits one sentence under
// the title, so it takes the first of the description.
export const alt = `${appName}: ${siteTagline}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return generateOGImage({
    title: siteTagline,
    description: 'The Mongoose alternative built on Zod and the official MongoDB driver.',
    site: appName
  })
}
