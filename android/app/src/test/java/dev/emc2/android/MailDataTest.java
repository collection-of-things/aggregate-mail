package dev.emc2.android;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class MailDataTest {
    static JSONObject account() throws Exception {
        return MailData.account("Test", "sender@example.invalid", "sender", "synthetic-only", "imap.example.invalid", "993", "smtp.example.invalid", "587", false);
    }
    static JSONObject state() throws Exception {
        JSONObject state = MailData.empty(); state.getJSONArray("accounts").put(account()); return state;
    }
    static JSONObject draft(JSONObject state) throws Exception {
        return new JSONObject().put("account", state.getJSONArray("accounts").getJSONObject(0).getString("id"))
                .put("to", "recipient@example.invalid").put("subject", "Synthetic test").put("body", "Test message");
    }
    @Test public void rejectsHeaderInjectionAndMultipleRecipients() throws Exception {
        for (String address : new String[]{"a@example.invalid\r\nBcc: x@example.invalid", "a@example.invalid,b@example.invalid", "Test <a@example.invalid>", "a"}) {
            assertThrows(Exception.class, () -> MailData.address(address));
        }
        assertEquals("a@example.invalid", MailData.address("a@example.invalid"));
    }
    @Test public void validatesServerAndPorts() {
        assertEquals("imap.example.invalid", MailData.host("imap.example.invalid"));
        for (String host : new String[]{"https://example.invalid", "host:993", "a b", ".host", "a..b"})
            assertThrows(IllegalArgumentException.class, () -> MailData.host(host));
        for (String port : new String[]{"0", "65536", "abc", "-1"}) assertThrows(IllegalArgumentException.class, () -> MailData.port(port));
    }
    @Test public void uncertainSendSurvivesSerializationAndBlocksWrites() throws Exception {
        JSONObject state = state(), draft = draft(state);
        MailData.saveDraft(state, draft); MailData.beginSend(state);
        JSONObject restored = MailData.copy(state);
        assertTrue(restored.getBoolean("pending"));
        assertThrows(IllegalStateException.class, () -> MailData.beginSend(restored));
        assertThrows(IllegalStateException.class, () -> MailData.saveDraft(restored, new JSONObject()));
        assertEquals(draft.toString(), restored.getJSONObject("draft").toString());
    }
    @Test public void completionRequiresExactPendingDraft() throws Exception {
        JSONObject state = state(), sent = draft(state);
        MailData.saveDraft(state, sent); MailData.beginSend(state);
        JSONObject different = MailData.copy(sent).put("body", "Different");
        assertThrows(IllegalStateException.class, () -> MailData.completeSend(state, different));
        assertTrue(state.getBoolean("pending"));
        MailData.completeSend(state, sent);
        assertFalse(state.getBoolean("pending")); assertEquals(0, state.getJSONObject("draft").length());
    }
    @Test public void invalidDraftNeverBecomesPending() throws Exception {
        JSONObject state = state(), draft = draft(state).put("subject", "bad\nheader");
        MailData.saveDraft(state, draft);
        assertThrows(Exception.class, () -> MailData.beginSend(state));
        assertFalse(state.getBoolean("pending"));
        draft.put("subject", "OK").put("account", "unknown");
        assertThrows(Exception.class, () -> MailData.validateDraft(state, draft));
    }
}
