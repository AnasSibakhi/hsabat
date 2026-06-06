-- =============================================
-- نظام الصلاحيات الكامل
-- شغّل هذا في Supabase SQL Editor
-- =============================================

-- 1. جدول الحسابات مع الأدوار
create table if not exists app_accounts (
  id text primary key,
  username text not null unique,
  password text not null,
  store_name text not null,
  owner_name text not null,
  role text not null default 'owner', -- superadmin / owner / employee
  is_active boolean default true,
  subscription_end date default (now() + interval '1 year'),
  created_at timestamptz default now()
);
alter table app_accounts disable row level security;

-- 2. جدول صلاحيات الموظفين
create table if not exists employee_permissions (
  id uuid primary key default gen_random_uuid(),
  employee_id text references app_accounts(id) on delete cascade,
  store_id text references stores(id) on delete cascade,
  can_invoice boolean default true,
  can_view_products boolean default true,
  can_add_sales boolean default true,
  can_view_debts boolean default false,
  can_add_debts boolean default false,
  can_delete boolean default false,
  can_view_reports boolean default false,
  created_at timestamptz default now()
);
alter table employee_permissions disable row level security;

-- 3. إدخال Super Admin
insert into app_accounts (id, username, password, store_name, owner_name, role)
values ('superadmin-001', 'admin@hesabat.com', 'anas12345!', 'النظام', 'Super Admin', 'superadmin')
on conflict (id) do update set username='admin@hesabat.com', password='anas12345!', role='superadmin';

-- 4. جدول الإشعارات
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  from_id text not null,
  to_store_id text, -- null = لجميع المحلات
  title text not null,
  message text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);
alter table notifications disable row level security;

-- 5. إضافة حقول للـ stores
alter table stores add column if not exists is_active boolean default true;
alter table stores add column if not exists subscription_end date default (now() + interval '1 year');
alter table stores add column if not exists plan text default 'basic';
