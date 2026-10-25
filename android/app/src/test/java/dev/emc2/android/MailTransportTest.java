package dev.emc2.android;

import org.junit.Test;
import javax.mail.Session;
import javax.mail.internet.MimeMessage;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import static org.junit.Assert.*;

public class MailTransportTest {
    private MimeMessage message(String raw) throws Exception {
        return new MimeMessage(Session.getInstance(new Properties()), new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8)));
    }
    @Test public void tlsVerifiesIdentityAndRequiresUpgradeBeforeSmtpAuth() throws Exception {
        Properties p = MailTransport.properties(MailDataTest.account());
        for (String protocol : new String[]{"imaps", "smtp", "smtps"}) {
            assertEquals("true", p.getProperty("mail." + protocol + ".ssl.checkserveridentity"));
            assertNull(p.getProperty("mail." + protocol + ".ssl.trust"));
            assertEquals("15000", p.getProperty("mail." + protocol + ".timeout"));
        }
        assertEquals("true", p.getProperty("mail.smtp.starttls.required"));
        assertEquals("true", p.getProperty("mail.imaps.peek"));
    }
    @Test public void refusesSmtpWithoutStartTlsBeforeSendingCredentials() throws Exception {
        java.net.ServerSocket server = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress());
        server.setSoTimeout(5000);
        java.util.List<String> commands = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        Thread peer = new Thread(() -> {
            try (java.net.Socket socket = server.accept()) {
                socket.setSoTimeout(3000);
                java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                java.io.PrintWriter output = new java.io.PrintWriter(socket.getOutputStream(), true);
                output.print("220 synthetic SMTP\r\n"); output.flush();
                String line;
                while ((line = input.readLine()) != null) {
                    commands.add(line);
                    if (line.startsWith("EHLO")) { output.print("250 synthetic server\r\n"); output.flush(); }
                    else if (line.startsWith("QUIT")) { output.print("221 bye\r\n"); output.flush(); break; }
                    else { output.print("500 unexpected command\r\n"); output.flush(); }
                }
            } catch (Exception ignored) { }
        });
        peer.setDaemon(true); peer.start();
        try {
            org.json.JSONObject account = MailDataTest.account().put("smtp", "localhost").put("smtpPort", server.getLocalPort());
            org.json.JSONObject state = MailData.empty(); state.getJSONArray("accounts").put(account);
            assertThrows(Exception.class, () -> MailTransport.send(account, MailDataTest.draft(state)));
            peer.join(4000);
            assertFalse(peer.isAlive());
            assertTrue(commands.stream().anyMatch(c -> c.startsWith("EHLO")));
            assertFalse(commands.stream().anyMatch(c -> c.startsWith("AUTH") || c.startsWith("MAIL") || c.startsWith("DATA")));
        } finally { server.close(); }
    }
    @Test public void capsRawInputBeforeParsingAndChecksDeadline() throws Exception {
        assertEquals(4, MailTransport.limited(new ByteArrayInputStream(new byte[4]), 4, Long.MAX_VALUE).length);
        assertThrows(Exception.class, () -> MailTransport.limited(new ByteArrayInputStream(new byte[5]), 4, Long.MAX_VALUE));
        assertThrows(Exception.class, () -> MailTransport.limited(new ByteArrayInputStream(new byte[1]), 4, 0));
    }
    @Test public void decodesPlainAlternativeAndSkipsAttachments() throws Exception {
        String raw = "MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=x\r\n\r\n"
                + "--x\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<img src='https://example.invalid/private'>HTML\r\n"
                + "--x\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlain body\r\n--x--\r\n";
        MailTransport.Body body = MailTransport.body(message(raw), 0, new int[]{0});
        assertFalse(body.html); assertEquals("Plain body", body.text);
        body = MailTransport.body(message("Content-Type: text/plain\r\nContent-Disposition: attachment; filename=test.txt\r\n\r\nPrivate attachment"), 0, new int[]{0});
        assertEquals("", body.text);
    }
    @Test public void boundsTextAndStructure() throws Exception {
        String huge = "a".repeat(MailData.MAX_TEXT + 1);
        MailTransport.Body body = MailTransport.body(message("Content-Type: text/plain\r\n\r\n" + huge), 0, new int[]{0});
        assertTrue(body.truncated); assertEquals(MailData.MAX_TEXT, body.text.length());
        assertThrows(Exception.class, () -> MailTransport.body(message("\r\ntext"), 13, new int[]{0}));
        assertThrows(Exception.class, () -> MailTransport.body(message("\r\ntext"), 0, new int[]{128}));
    }
}
