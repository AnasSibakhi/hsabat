/**
 * constants.js — Single source of truth for all app constants
 * Never hardcode magic strings anywhere else in the codebase
 */

export const CONFIG = Object.freeze({
  supabaseUrl:        'https://omtrbatypecsraettrbw.supabase.co',
  supabaseAnonKey:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdHJiYXR5cGVjc3JhZXR0cmJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MTUzNTIsImV4cCI6MjA5NjA5MTM1Mn0.71cyb5LBkCJTX1fcVNCuD8u28waSI4fWeai4ccW-asU',
  supabaseServiceKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tdHJiYXR5cGVjc3JhZXR0cmJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDUxNTM1MiwiZXhwIjoyMDk2MDkxMzUyfQ.Oklmu9ht2PEA02d0Qy-oS-UXl0Oa4wf560BqzxwyC04',
  debtLateDays:       2,
  lowStockDefault:    10,
  lowStockThreshold:  20,
  netCardTypes:       ['1', '2', '3'],
});

export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  OWNER:      'owner',
  EMPLOYEE:   'employee',
});

export const PAYMENT = Object.freeze({
  CASH:     'cash',
  TRANSFER: 'transfer',
  DEFER:    'defer',
  PARTIAL:  'partial',
});

export const RETURN_TYPE = Object.freeze({
  CASH:     'cash',
  DEBT:     'debt',
  TRANSFER: 'transfer',
});
