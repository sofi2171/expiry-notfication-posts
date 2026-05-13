const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ============================================
// 🔥 FIREBASE ADMIN INIT
// ============================================
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://jobs-45cc9-default-rtdb.firebaseio.com"
    });
}

const db = admin.firestore();

// ============================================
// 📧 HELPER: Brevo سے email بھیجو
//
// Vercel Environment Variables میں یہ ڈالیں:
//   BREVO_API_KEY  = آپ کی Brevo API key (brevo.com سے لیں)
//   FROM_EMAIL     = وہ email جس سے بھیجنا ہے (Brevo میں verify کریں)
//   FROM_NAME      = Health Jobs Portal  (یا جو چاہیں)
// ============================================
async function sendEmail({ to, subject, html }) {
    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': process.env.BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: {
                    name: process.env.FROM_NAME || 'Health Jobs Portal',
                    email: process.env.FROM_EMAIL
                },
                to: [{ email: to }],
                subject: subject,
                htmlContent: html
            })
        });

        const result = await response.json();

        if (!response.ok) {
            console.error(`❌ Brevo error for ${to}:`, result);
            return false;
        }

        console.log(`✅ Email sent to: ${to}`);
        return true;

    } catch (err) {
        console.error(`❌ Email failed to ${to}:`, err.message);
        return false;
    }
}

// ============================================
// 🔔 ROUTE 1: نئی پوسٹ پر matched users کو email
// POST /api/notify-matched-users
// Frontend سے call ہوگا جب نئی post publish ہو
// ============================================
app.post('/api/notify-matched-users', async (req, res) => {
    try {
        const {
            postId, title, category, location,
            salary, posterName, posterId, postType, link
        } = req.body;

        if (!postId || !category) {
            return res.status(400).json({ success: false, message: "postId and category required." });
        }

        // Firestore سے سارے users لاؤ
        const usersSnap = await db.collection('users').get();

        if (usersSnap.empty) {
            return res.json({ success: true, message: "No users found.", sent: 0 });
        }

        let sent = 0;

        for (const userDoc of usersSnap.docs) {
            const user = userDoc.data();

            // email نہ ہو تو skip
            if (!user.email) continue;

            // خود poster کو skip
            if (userDoc.id === posterId) continue;

            // ─── Matching Logic ───
            const userCategory = (user.category || user.profession || user.qualification || '').toLowerCase();
            const userLocation  = (user.city || user.location || '').toLowerCase();
            const postCategory  = (category || '').toLowerCase();
            const postLocation  = (location || '').toLowerCase();

            const categoryMatch = userCategory && postCategory && (
                userCategory.includes(postCategory.split(' ')[0]) ||
                postCategory.includes(userCategory.split(' ')[0])
            );

            const locationMatch = userLocation && postLocation && (
                postLocation.includes(userLocation) ||
                userLocation.includes(postLocation)
            );

            // کم از کم ایک میچ ضروری ہے
            if (!categoryMatch && !locationMatch) continue;

            const isEmployerPost = postType === 'employer_post';

            const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f3f2ef;padding:20px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e0dfdc;">

    <div style="background:#0a66c2;padding:24px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:22px;">Health Jobs Portal</h1>
      <p style="color:#cce4ff;margin:6px 0 0;font-size:14px;">
        ${isEmployerPost ? '🏥 نئی Job Vacancy آئی ہے' : '👨‍⚕️ نیا Candidate Available ہے'}
      </p>
    </div>

    <div style="padding:28px;">
      <p style="font-size:15px;color:#000000cc;margin:0 0 20px;">
        آپ کی profile سے match کرتی ہوئی ایک نئی post آئی ہے:
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:20px;">
        <h2 style="font-size:18px;color:#0a66c2;margin:0 0 12px;">${title}</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:5px 0;font-size:13px;color:#64748b;width:120px;">📋 Category</td>
            <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;">${category}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;font-size:13px;color:#64748b;">📍 Location</td>
            <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;">${location}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;font-size:13px;color:#64748b;">💰 Salary</td>
            <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;">${salary}</td>
          </tr>
          <tr>
            <td style="padding:5px 0;font-size:13px;color:#64748b;">👤 Posted by</td>
            <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;">${posterName}</td>
          </tr>
        </table>
      </div>

      <div style="text-align:center;margin:24px 0;">
        <a href="${link}"
           style="background:#0a66c2;color:white;padding:14px 32px;border-radius:24px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
          پوری Post دیکھیں →
        </a>
      </div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0;">
        یہ email آپ کو اس لیے ملی کیونکہ آپ کی profile اس post سے match کرتی ہے۔<br>
        Health Jobs Portal — healthjobs-portal.web.app
      </p>
    </div>
  </div>
</body>
</html>`;

            await sendEmail({
                to: user.email,
                subject: isEmployerPost
                    ? `🏥 نئی Job: ${title}`
                    : `👨‍⚕️ نیا Candidate: ${title}`,
                html: emailHtml
            });

            sent++;
        }

        return res.json({ success: true, sent, message: `${sent} matched users notified.` });

    } catch (err) {
        console.error("Notify Error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// ⏰ ROUTE 2: Expiry Warning — 24 گھنٹے پہلے
// GET /api/expiry-warning
// vercel.json cron سے ہر گھنٹے auto چلے گا
// ============================================
app.get('/api/expiry-warning', async (req, res) => {
    try {
        const now    = new Date();
        const nowISO = now.toISOString();
        const in24h  = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

        // وہ posts جو اگلے 24 گھنٹوں میں expire ہونے والی ہیں اور warning ابھی نہیں گئی
        const snapshot = await db.collection('posts')
            .where('expiresAt', '>=', nowISO)
            .where('expiresAt', '<=', in24h)
            .where('expiryEmailSent', '==', false)
            .get();

        if (snapshot.empty) {
            return res.json({ success: true, message: "No posts expiring soon.", warned: 0 });
        }

        let warned = 0;

        for (const docSnap of snapshot.docs) {
            const post = docSnap.data();

            // Poster کی email Firestore سے لاؤ
            let posterEmail = null;
            try {
                const userDoc = await db.collection('users').doc(post.posterId).get();
                if (userDoc.exists) posterEmail = userDoc.data().email || null;
            } catch (e) {
                console.error("User fetch error:", e.message);
            }

            if (!posterEmail) continue;

            const expiryDate = new Date(post.expiresAt).toLocaleString('en-PK', {
                timeZone: 'Asia/Karachi',
                dateStyle: 'medium',
                timeStyle: 'short'
            });

            const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f3f2ef;padding:20px;margin:0;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e0dfdc;">

    <div style="background:#dc2626;padding:24px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:22px;">⚠️ Post Expire ہونے والی ہے!</h1>
      <p style="color:#fecaca;margin:6px 0 0;font-size:14px;">صرف 24 گھنٹے باقی ہیں</p>
    </div>

    <div style="padding:28px;">
      <p style="font-size:15px;color:#000000cc;margin:0 0 20px;">
        آپ کی یہ post کل expire ہو جائے گی:
      </p>

      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:20px;margin-bottom:20px;">
        <h2 style="font-size:18px;color:#ea580c;margin:0 0 10px;">${post.title}</h2>
        <p style="font-size:13px;color:#64748b;margin:0;">
          ⏰ Expire ہونے کا وقت: <strong style="color:#dc2626;">${expiryDate}</strong>
        </p>
      </div>

      <p style="font-size:14px;color:#475569;margin:0 0 20px;">
        اگر آپ اسے جاری رکھنا چاہتے ہیں تو نئی post publish کریں۔
      </p>

      <div style="text-align:center;margin:24px 0;">
        <a href="https://healthjobs-portal.web.app"
           style="background:#0a66c2;color:white;padding:14px 32px;border-radius:24px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
          نئی Post کریں →
        </a>
      </div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0;">
        Health Jobs Portal — healthjobs-portal.web.app
      </p>
    </div>
  </div>
</body>
</html>`;

            await sendEmail({
                to: posterEmail,
                subject: `⚠️ آپ کی post "${post.title}" 24 گھنٹوں میں expire ہو گی`,
                html: emailHtml
            });

            // Mark کرو کہ warning email بھیج دی
            await db.collection('posts').doc(docSnap.id).update({ expiryEmailSent: true });
            warned++;
        }

        return res.json({ success: true, warned, message: `${warned} expiry warning(s) sent.` });

    } catch (err) {
        console.error("Expiry Warning Error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = app; 
