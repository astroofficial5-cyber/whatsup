# Whatsup

A WhatsApp-Web-inspired full-stack chat starter built with Next.js, React, and Supabase.

## Included
- Responsive desktop/mobile chat layout
- Searchable conversation list
- Sign-up and login via Supabase Auth
- PostgreSQL tables for profiles, chats, members, and messages
- Row Level Security policies
- Realtime incoming-message subscription
- Local preview mode when Supabase is not configured

## Run locally
1. Install Node.js 20 or later.
2. In this folder run `npm install`.
3. Copy `.env.local.example` to `.env.local`.
4. Create a Supabase project at https://supabase.com.
5. In Supabase, open **SQL Editor** and run `supabase/schema.sql`.
6. In Supabase project settings, copy the Project URL and anon/public key into `.env.local`.
7. In Supabase Authentication settings, configure your allowed redirect URLs (for local development, `http://localhost:3000`).
8. Run `npm run dev` and open http://localhost:3000.

## Important notes
- Without Supabase credentials, the app opens in a local preview using sample conversations; messages are only held in browser memory.
- The backend becomes active after Supabase is configured. Create real chat and membership records before users can exchange messages.
- This starter is not yet production-ready end-to-end encryption. Do not describe it as encrypted like WhatsApp.
- Before public launch, add rate limits, abuse reporting/blocking, account deletion, storage policies, message pagination, and stronger membership-management functions.
- Add storage buckets and policies before enabling image/file uploads.
- Never put a Supabase service-role key in browser code. Use only the anon/publishable key in `.env.local`.
