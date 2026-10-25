package dev.emc2.android;

import com.sun.mail.imap.IMAPMessage;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.mail.*;
import javax.mail.internet.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Properties;

/** TLS-only provider operations. Credentials, message contents and exceptions are never logged. */
final class MailTransport {
    static Properties properties(JSONObject account) throws Exception {
        Properties p = new Properties();
        java.util.Set<String> supported = new java.util.HashSet<>(java.util.Arrays.asList(
                javax.net.ssl.SSLContext.getDefault().getSupportedSSLParameters().getProtocols()));
        String tls = supported.contains("TLSv1.3") ? "TLSv1.2 TLSv1.3" : "TLSv1.2";
        for (String protocol : new String[]{"imaps", "smtp", "smtps"}) {
            String prefix = "mail." + protocol + ".";
            p.setProperty(prefix + "connectiontimeout", "15000");
            p.setProperty(prefix + "timeout", "15000");
            p.setProperty(prefix + "writetimeout", "15000");
            p.setProperty(prefix + "ssl.checkserveridentity", "true");
            p.setProperty(prefix + "ssl.protocols", tls);
        }
        p.setProperty("mail.imaps.peek", "true");
        p.setProperty("mail.imaps.partialfetch", "true");
        p.setProperty("mail.imaps.fetchsize", "16384");
        p.setProperty("mail.smtp.starttls.enable", "true");
        p.setProperty("mail.smtp.starttls.required", "true");
        p.setProperty("mail.smtp.auth", "true");
        p.setProperty("mail.smtps.auth", "true");
        return p;
    }

    static byte[] limited(InputStream input, int maximum, long deadline) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer, 0, Math.min(buffer.length, maximum + 1 - bytes.size()))) != -1) {
            if (System.nanoTime() > deadline) throw new IllegalStateException("Mail operation timed out.");
            bytes.write(buffer, 0, count);
            if (bytes.size() > maximum) throw new IllegalStateException("Message exceeds the download limit.");
        }
        return bytes.toByteArray();
    }

    static JSONArray inbox(JSONObject account) throws Exception {
        long deadline = System.nanoTime() + 90_000_000_000L;
        Session session = Session.getInstance(properties(account));
        Store store = session.getStore("imaps");
        Folder folder = null;
        try {
            store.connect(account.getString("imap"), account.getInt("imapPort"), account.getString("user"), account.getString("password"));
            folder = store.getFolder("INBOX");
            folder.open(Folder.READ_ONLY);
            UIDFolder uids = (UIDFolder) folder;
            long validity = uids.getUIDValidity();
            int count = folder.getMessageCount();
            JSONArray result = new JSONArray();
            for (int n = count; n >= Math.max(1, count - MailData.MAX_MESSAGES + 1); n--) {
                if (System.nanoTime() > deadline) throw new IllegalStateException("Mail operation timed out.");
                IMAPMessage source = (IMAPMessage) folder.getMessage(n);
                if (source.getSize() < 0 || source.getSize() > MailData.MAX_RAW)
                    throw new IllegalStateException("An inbox message exceeds 256 KiB. Previous cached mail was kept.");
                byte[] raw;
                try (InputStream input = source.getMimeStream()) { raw = limited(input, MailData.MAX_RAW, deadline); }
                MimeMessage mail = new MimeMessage(session, new ByteArrayInputStream(raw));
                Body body = body(mail, 0, new int[]{0});
                Address[] senders = mail.getFrom();
                String from = senders == null || senders.length == 0 ? "Unknown sender" : senders[0].toString();
                String reply = "";
                Address[] replies = mail.getReplyTo();
                if (replies != null && replies.length > 0 && replies[0] instanceof InternetAddress)
                    reply = ((InternetAddress) replies[0]).getAddress();
                Date date = mail.getSentDate();
                result.put(new JSONObject().put("account", account.getString("id"))
                        .put("id", validity + ":" + uids.getUID(source)).put("from", from)
                        .put("reply", reply).put("subject", mail.getSubject() == null ? "(No subject)" : mail.getSubject())
                        .put("date", date == null ? 0 : date.getTime()).put("body", body.text).put("html", body.html)
                        .put("truncated", body.truncated));
            }
            return result;
        } finally {
            if (folder != null && folder.isOpen()) try { folder.close(false); } catch (MessagingException ignored) { }
            if (store.isConnected()) try { store.close(); } catch (MessagingException ignored) { }
        }
    }

    static final class Body {
        final String text;
        final boolean html, truncated;
        Body(String text, boolean html) {
            this.truncated = text.length() > MailData.MAX_TEXT;
            this.text = text.substring(0, Math.min(text.length(), MailData.MAX_TEXT)); this.html = html;
        }
    }

    static Body body(Part part, int depth, int[] parts) throws Exception {
        if (depth > 12 || ++parts[0] > 128) throw new IllegalStateException("Message MIME structure exceeds safe limits.");
        if (Part.ATTACHMENT.equalsIgnoreCase(part.getDisposition()) || part.getFileName() != null) return new Body("", false);
        if (part.isMimeType("text/plain") || part.isMimeType("text/html"))
            return new Body((String) part.getContent(), part.isMimeType("text/html"));
        if (part.isMimeType("multipart/*")) {
            Multipart multi = (Multipart) part.getContent();
            if (multi.getCount() > 128) throw new IllegalStateException("Too many MIME parts.");
            Body fallback = new Body("", false);
            // A single display body avoids mixing plain and HTML alternatives or executing sender content.
            for (int i = 0; i < multi.getCount(); i++) {
                Body candidate = body(multi.getBodyPart(i), depth + 1, parts);
                if (!candidate.text.isEmpty()) {
                    if (!candidate.html) return candidate;
                    if (fallback.text.isEmpty()) fallback = candidate;
                }
            }
            return fallback;
        }
        return new Body("No supported text body. Attachments are not downloaded.", false);
    }

    static void send(JSONObject account, JSONObject draft) throws Exception {
        Session session = Session.getInstance(properties(account));
        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress(account.getString("email")));
        message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(draft.getString("to"), true));
        message.setSubject(draft.getString("subject"), StandardCharsets.UTF_8.name());
        message.setText(draft.getString("body"), StandardCharsets.UTF_8.name());
        message.setSentDate(new Date());
        message.saveChanges();
        Transport transport = session.getTransport(account.getBoolean("implicit") ? "smtps" : "smtp");
        try {
            transport.connect(account.getString("smtp"), account.getInt("smtpPort"), account.getString("user"), account.getString("password"));
            transport.sendMessage(message, message.getAllRecipients());
        } finally {
            if (transport.isConnected()) try { transport.close(); } catch (MessagingException ignored) { }
        }
    }
}
