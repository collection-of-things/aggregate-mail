package dev.emc2.android;

import com.sun.mail.imap.IMAPMessage;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.mail.*;
import javax.mail.internet.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Properties;

/** TLS-only provider operations. Credentials, message contents and exceptions are never logged. */
final class MailTransport {
    /** A literal announcement larger than this is rejected before allocation. */
    private static final int MAX_LITERAL = 1048576;

    /**
     * Aborts a connection when the wire announces an oversized IMAP literal,
     * before the provider can allocate for it. A "{n}" marker only counts at
     * end of line; the same bytes inside genuine message content can trip the
     * guard, so a violation closes this connection and the previous cache stays.
     */
    private static final class LiteralGuardInputStream extends InputStream {
        private final InputStream inner;
        private int state; // 0 plain, 1 digits, 2 after '+', 3 after '}'
        private long size;
        private boolean big;
        LiteralGuardInputStream(InputStream inner) { this.inner = inner; }
        @Override public int read() throws java.io.IOException {
            int value = inner.read();
            if (value >= 0) guard((byte) value);
            return value;
        }
        @Override public int read(byte[] buffer, int offset, int length) throws java.io.IOException {
            int count = inner.read(buffer, offset, length);
            for (int i = 0; i < count; i++) guard(buffer[offset + i]);
            return count;
        }
        private void guard(byte b) throws java.io.IOException {
            if (state == 1) {
                if (b >= '0' && b <= '9') {
                    if (size <= MAX_LITERAL) size = size * 10 + (b - '0');
                    if (size > MAX_LITERAL) big = true;
                    return;
                }
                if (b == '}') { state = 3; return; }
                if (b == '+') { state = 2; return; }
                state = 0;
            } else if (state == 2) {
                state = b == '}' ? 3 : 0;
            } else if (state == 3) {
                state = 0;
                if (b == '\r' && big) throw new java.io.IOException("Mail server announced an oversized literal.");
            }
            if (b == '{') { state = 1; size = 0; big = false; }
        }
    }

    /**
     * TLS socket that verifies the certificate against the connected host with
     * the platform's strict verifier (single-label wildcards) inside the
     * handshake, before any credential or protocol byte is sent.
     */
    private static final class GuardedSocket extends javax.net.ssl.SSLSocket {
        private final javax.net.ssl.SSLSocket inner;
        private String host;
        private InputStream input;
        GuardedSocket(javax.net.ssl.SSLSocket inner, String host) { this.inner = inner; this.host = host; }
        private void remember(java.net.SocketAddress endpoint) {
            if (endpoint instanceof java.net.InetSocketAddress)
                host = ((java.net.InetSocketAddress) endpoint).getHostString();
        }
        @Override public void startHandshake() throws java.io.IOException {
            inner.startHandshake();
            if (host == null || !javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(host, inner.getSession()))
                throw new javax.net.ssl.SSLPeerUnverifiedException("TLS certificate does not match the mail host.");
        }
        @Override public InputStream getInputStream() throws java.io.IOException {
            if (input == null) input = new LiteralGuardInputStream(inner.getInputStream());
            return input;
        }
        @Override public void connect(java.net.SocketAddress endpoint) throws java.io.IOException { inner.connect(endpoint); remember(endpoint); }
        @Override public void connect(java.net.SocketAddress endpoint, int timeout) throws java.io.IOException { inner.connect(endpoint, timeout); remember(endpoint); }
        @Override public void bind(java.net.SocketAddress bindpoint) throws java.io.IOException { inner.bind(bindpoint); }
        @Override public java.net.InetAddress getInetAddress() { return inner.getInetAddress(); }
        @Override public java.net.InetAddress getLocalAddress() { return inner.getLocalAddress(); }
        @Override public int getPort() { return inner.getPort(); }
        @Override public int getLocalPort() { return inner.getLocalPort(); }
        @Override public java.net.SocketAddress getRemoteSocketAddress() { return inner.getRemoteSocketAddress(); }
        @Override public java.net.SocketAddress getLocalSocketAddress() { return inner.getLocalSocketAddress(); }
        @Override public java.nio.channels.SocketChannel getChannel() { return inner.getChannel(); }
        @Override public java.io.OutputStream getOutputStream() throws java.io.IOException { return inner.getOutputStream(); }
        @Override public void setTcpNoDelay(boolean on) throws java.net.SocketException { inner.setTcpNoDelay(on); }
        @Override public boolean getTcpNoDelay() throws java.net.SocketException { return inner.getTcpNoDelay(); }
        @Override public void setSoLinger(boolean on, int linger) throws java.net.SocketException { inner.setSoLinger(on, linger); }
        @Override public int getSoLinger() throws java.net.SocketException { return inner.getSoLinger(); }
        @Override public void sendUrgentData(int data) throws java.io.IOException { inner.sendUrgentData(data); }
        @Override public void setOOBInline(boolean on) throws java.net.SocketException { inner.setOOBInline(on); }
        @Override public boolean getOOBInline() throws java.net.SocketException { return inner.getOOBInline(); }
        @Override public synchronized void setSoTimeout(int timeout) throws java.net.SocketException { inner.setSoTimeout(timeout); }
        @Override public synchronized int getSoTimeout() throws java.net.SocketException { return inner.getSoTimeout(); }
        @Override public synchronized void setSendBufferSize(int size) throws java.net.SocketException { inner.setSendBufferSize(size); }
        @Override public synchronized int getSendBufferSize() throws java.net.SocketException { return inner.getSendBufferSize(); }
        @Override public synchronized void setReceiveBufferSize(int size) throws java.net.SocketException { inner.setReceiveBufferSize(size); }
        @Override public synchronized int getReceiveBufferSize() throws java.net.SocketException { return inner.getReceiveBufferSize(); }
        @Override public void setKeepAlive(boolean on) throws java.net.SocketException { inner.setKeepAlive(on); }
        @Override public boolean getKeepAlive() throws java.net.SocketException { return inner.getKeepAlive(); }
        @Override public void close() throws java.io.IOException { inner.close(); }
        @Override public void shutdownInput() throws java.io.IOException { inner.shutdownInput(); }
        @Override public void shutdownOutput() throws java.io.IOException { inner.shutdownOutput(); }
        @Override public String toString() { return inner.toString(); }
        @Override public boolean isConnected() { return inner.isConnected(); }
        @Override public boolean isBound() { return inner.isBound(); }
        @Override public boolean isClosed() { return inner.isClosed(); }
        @Override public boolean isInputShutdown() { return inner.isInputShutdown(); }
        @Override public boolean isOutputShutdown() { return inner.isOutputShutdown(); }
        @Override public void setReuseAddress(boolean on) throws java.net.SocketException { inner.setReuseAddress(on); }
        @Override public boolean getReuseAddress() throws java.net.SocketException { return inner.getReuseAddress(); }
        @Override public void setPerformancePreferences(int connectionTime, int latency, int bandwidth) { inner.setPerformancePreferences(connectionTime, latency, bandwidth); }
        @Override public String[] getSupportedCipherSuites() { return inner.getSupportedCipherSuites(); }
        @Override public String[] getEnabledCipherSuites() { return inner.getEnabledCipherSuites(); }
        @Override public void setEnabledCipherSuites(String[] suites) { inner.setEnabledCipherSuites(suites); }
        @Override public String[] getSupportedProtocols() { return inner.getSupportedProtocols(); }
        @Override public String[] getEnabledProtocols() { return inner.getEnabledProtocols(); }
        @Override public void setEnabledProtocols(String[] protocols) { inner.setEnabledProtocols(protocols); }
        @Override public javax.net.ssl.SSLSession getSession() { return inner.getSession(); }
        @Override public void addHandshakeCompletedListener(javax.net.ssl.HandshakeCompletedListener listener) { inner.addHandshakeCompletedListener(listener); }
        @Override public void removeHandshakeCompletedListener(javax.net.ssl.HandshakeCompletedListener listener) { inner.removeHandshakeCompletedListener(listener); }
        @Override public void setUseClientMode(boolean mode) { inner.setUseClientMode(mode); }
        @Override public boolean getUseClientMode() { return inner.getUseClientMode(); }
        @Override public void setNeedClientAuth(boolean need) { inner.setNeedClientAuth(need); }
        @Override public boolean getNeedClientAuth() { return inner.getNeedClientAuth(); }
        @Override public void setWantClientAuth(boolean want) { inner.setWantClientAuth(want); }
        @Override public boolean getWantClientAuth() { return inner.getWantClientAuth(); }
        @Override public void setEnableSessionCreation(boolean flag) { inner.setEnableSessionCreation(flag); }
        @Override public boolean getEnableSessionCreation() { return inner.getEnableSessionCreation(); }
        @Override public javax.net.ssl.SSLParameters getSSLParameters() { return inner.getSSLParameters(); }
        @Override public void setSSLParameters(javax.net.ssl.SSLParameters params) { inner.setSSLParameters(params); }
    }

    private static final class StrictTlsSocketFactory extends javax.net.ssl.SSLSocketFactory {
        private final javax.net.ssl.SSLSocketFactory delegate =
                (javax.net.ssl.SSLSocketFactory) javax.net.ssl.SSLSocketFactory.getDefault();
        private Socket guarded(Socket socket, String host) {
            if (socket instanceof javax.net.ssl.SSLSocket) return new GuardedSocket((javax.net.ssl.SSLSocket) socket, host);
            return socket;
        }
        @Override public String[] getDefaultCipherSuites() { return delegate.getDefaultCipherSuites(); }
        @Override public String[] getSupportedCipherSuites() { return delegate.getSupportedCipherSuites(); }
        @Override public Socket createSocket() throws java.io.IOException { return guarded(delegate.createSocket(), null); }
        @Override public Socket createSocket(Socket socket, String host, int port, boolean close) throws java.io.IOException {
            return guarded(delegate.createSocket(socket, host, port, close), host);
        }
        @Override public Socket createSocket(String host, int port) throws java.io.IOException {
            return guarded(delegate.createSocket(host, port), host);
        }
        @Override public Socket createSocket(String host, int port, java.net.InetAddress local, int localPort) throws java.io.IOException {
            return guarded(delegate.createSocket(host, port, local, localPort), host);
        }
        @Override public Socket createSocket(java.net.InetAddress host, int port) throws java.io.IOException {
            return guarded(delegate.createSocket(host, port), host.getHostName());
        }
        @Override public Socket createSocket(java.net.InetAddress host, int port, java.net.InetAddress local, int localPort) throws java.io.IOException {
            return guarded(delegate.createSocket(host, port, local, localPort), host.getHostName());
        }
    }

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
        StrictTlsSocketFactory tlsSockets = new StrictTlsSocketFactory();
        p.put("mail.imaps.ssl.socketFactory", tlsSockets);
        p.put("mail.smtp.ssl.socketFactory", tlsSockets);
        p.put("mail.smtps.ssl.socketFactory", tlsSockets);
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
            // RFC 2046 bounds a boundary at 70 characters; a longer value can
            // drive disproportionate multipart preprocessing before any part read.
            String boundary;
            try { boundary = new ContentType(part.getContentType()).getParameter("boundary"); }
            catch (Exception error) { throw new IllegalStateException("Message MIME structure exceeds safe limits."); }
            if (boundary != null && boundary.length() > 70) throw new IllegalStateException("Message MIME structure exceeds safe limits.");
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
