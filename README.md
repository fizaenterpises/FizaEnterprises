# Fiza Enterprises — Full-stack website starter

## Included
- Luxury public Hajj & Umrah website
- Real SQLite database
- Secure admin login with bcrypt password hashing
- Server-side sessions stored in SQLite
- Helmet security headers
- Rate limiting for login and public enquiries
- Admin enquiry dashboard with status workflow
- Package CRUD/archiving
- Business contact settings
- Customer package selection + enquiry request flow
- WhatsApp and email CTAs

## Contact
- Phone/WhatsApp: 9901884387
- Email: travelfizatours@gmail.com
- Location: Indipump, Hubli, Karnataka, India

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set a strong `SESSION_SECRET` (32+ random characters).
4. Set `ADMIN_USERNAME`.
5. Set `ADMIN_PASSWORD` to a strong password of at least 12 characters.
6. Run `npm install`.
7. Run `npm start`.
8. Open http://localhost:3000
9. Admin: http://localhost:3000/admin.html

The database is created automatically at `data/fiza.sqlite`.

## Production checklist
Before collecting real pilgrim data:
- Use HTTPS.
- Set NODE_ENV=production.
- Use a strong unique SESSION_SECRET.
- Use a strong unique admin password.
- Back up the database securely.
- Add a privacy policy and appropriate consent wording.
- Configure a real transactional email service for enquiry notifications.
- Consider a managed database/hosting setup for backups and availability.
- Review data retention and access rules for customer information.
- Do not collect passport numbers, payment card details, or other sensitive identity data unless there is a specific lawful and secure reason to do so.

This starter does NOT process online payments. It creates an enquiry/booking-assistance request so Fiza Enterprises can contact the pilgrim.
