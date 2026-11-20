-- 1. Tabel Users
CREATE TABLE IF NOT EXISTS public.fih_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  balance BIGINT DEFAULT 0,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabel Setoran Gmail (1 baris = 1 Gmail)
CREATE TABLE IF NOT EXISTS public.fih_deposits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.fih_users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  gmail_address TEXT NOT NULL,
  gmail_password TEXT NOT NULL,
  gmail_type TEXT NOT NULL,
  price BIGINT NOT NULL,
  status TEXT DEFAULT 'pending',
  reject_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabel Rekening Tujuan User
CREATE TABLE IF NOT EXISTS public.fih_payment_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.fih_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabel Penarikan Saldo
CREATE TABLE IF NOT EXISTS public.fih_withdrawals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.fih_users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  provider TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  amount BIGINT NOT NULL,
  status TEXT DEFAULT 'pending',
  reject_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Tabel Pengaturan Sistem & Admin
CREATE TABLE IF NOT EXISTS public.fih_settings (
  id INT PRIMARY KEY DEFAULT 1,
  is_deposit_open BOOLEAN DEFAULT true,
  price_good BIGINT DEFAULT 4000,
  price_capcay BIGINT DEFAULT 2000,
  admin_pin TEXT DEFAULT '123456'
);

-- Data Default Pengaturan & Akun Admin Awal
INSERT INTO public.fih_settings (id, is_deposit_open, price_good, price_capcay, admin_pin)
VALUES (1, true, 4000, 2000, '123456')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fih_users (username, email, password, balance, role)
VALUES ('admin', 'admin@fih.id', 'admin123', 0, 'admin')
ON CONFLICT (username) DO NOTHING;

ALTER TABLE public.fih_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fih_deposits DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fih_payment_methods DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fih_withdrawals DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fih_settings DISABLE ROW LEVEL SECURITY;