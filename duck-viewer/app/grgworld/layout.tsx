import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mongo & Kiwi · Pet camera',
  description: 'A live window into the shared grgworld office.',
};

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
