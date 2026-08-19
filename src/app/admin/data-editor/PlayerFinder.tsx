'use client';

import { useRouter } from 'next/navigation';

import { PlayerPicker } from '@/components/PlayerPicker';

/** Wraps the site's player autocomplete to open a player in the editor. */
export function PlayerFinder() {
  const router = useRouter();
  return (
    <PlayerPicker
      label="Find a player"
      onSelect={(selected) => {
        if (selected) router.push(`/admin/data-editor?entity=players&id=${selected.id}`);
      }}
    />
  );
}
