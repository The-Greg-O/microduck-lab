"use client";

import dynamic from 'next/dynamic';

const PetCamera = dynamic(() => import('@/components/grgworld/PetCamera'), { ssr: false });

export default function GrgWorldPage() { return <PetCamera />; }
