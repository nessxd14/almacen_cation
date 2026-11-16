import { describe, expect, it } from 'vitest';

describe('sinProduccion', () => {
  it('rechaza fetch a un host *.supabase.co', async () => {
    await expect(fetch('https://x.supabase.co/rest/v1/')).rejects.toThrow(
      'Test intentó llamar a Supabase real: https://x.supabase.co/rest/v1/',
    );
  });

  it('rechaza URL, Request y *.supabase.in', async () => {
    await expect(fetch(new URL('https://x.supabase.co/rest/v1/'))).rejects.toThrow(/Supabase real/);
    await expect(fetch(new Request('https://y.supabase.in/rest/v1/'))).rejects.toThrow(/Supabase real/);
  });

  it('usa una URL falsa de Supabase en las pruebas', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  });
});
