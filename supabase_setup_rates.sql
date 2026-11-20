-- 1. Tambah kolom harga di tabel app_settings dan atur nilai awal Good 4k & Captha 2k
alter table public.app_settings
  add column if not exists rate_good int8 not null default 4000,
  add column if not exists rate_captha int8 not null default 2000;

-- 2. Pastikan RLS policy mengizinkan baca/tulis/update dari Admin Panel
alter table public.app_settings enable row level security;
drop policy if exists "allow_all_app_settings" on public.app_settings;
create policy "allow_all_app_settings" on public.app_settings for all using (true) with check (true);

-- 3. Isi atau perbarui baris pengaturan utama (id = 1)
insert into public.app_settings (id, good_open, captha_open, pass_sgsg1122, pass_goldacok, rate_good, rate_captha)
values (1, true, true, true, false, 4000, 2000)
on conflict (id) do update
set rate_good = excluded.rate_good,
    rate_captha = excluded.rate_captha;
