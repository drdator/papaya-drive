import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Papaya Drive — a little forest driving game',
  description:
    'Take a low-poly hatchback for a spin. Follow the forest loop, find eight golden checkpoints, and enjoy the drive.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
