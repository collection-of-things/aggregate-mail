package dev.emc2.android;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;
import javax.mail.internet.InternetAddress;

/** Portable validation and snapshot transitions. No network or Android dependencies. */
final class MailData {
    static final int MAX_ACCOUNTS = 8, MAX_MESSAGES = 100, MAX_RAW = 256 * 1024,
            MAX_TEXT = 64 * 1024, MAX_SNAPSHOT = 8 * 1024 * 1024;

    static JSONObject empty() throws Exception {
        return new JSONObject().put("version", 1).put("accounts", new JSONArray())
                .put("messages", new JSONArray()).put("draft", new JSONObject()).put("pending", false);
    }

    static JSONObject copy(JSONObject value) throws Exception { return new JSONObject(value.toString()); }

    static String singleLine(String value, int max) {
        if (value == null || value.trim().isEmpty() || value.length() > max || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0)
            throw new IllegalArgumentException("Complete each field without line breaks.");
        return value.trim();
    }

    static String address(String value) throws Exception {
        String clean = singleLine(value, 254);
        InternetAddress[] addresses = InternetAddress.parse(clean, true);
        if (addresses.length != 1 || addresses[0].isGroup() || addresses[0].getPersonal() != null)
            throw new IllegalArgumentException("Enter one email address without a display name.");
        addresses[0].validate();
        if (!addresses[0].getAddress().contains("@")) throw new IllegalArgumentException("Enter a full email address.");
        return addresses[0].getAddress();
    }

    static String host(String value) {
        String clean = singleLine(value, 253);
        if (!clean.matches("(?i)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?") || clean.contains(".."))
            throw new IllegalArgumentException("Enter a server hostname without a URL or port.");
        return clean;
    }

    static int port(String value) {
        try {
            int port = Integer.parseInt(value);
            if (port > 0 && port <= 65535) return port;
        } catch (NumberFormatException ignored) { }
        throw new IllegalArgumentException("Enter a port from 1 to 65535.");
    }

    static JSONObject account(String label, String email, String user, String password,
                              String imap, String imapPort, String smtp, String smtpPort, boolean implicit) throws Exception {
        if (password.isEmpty() || password.length() > 1024) throw new IllegalArgumentException("Enter an app password.");
        return new JSONObject().put("id", UUID.randomUUID().toString()).put("label", singleLine(label, 100))
                .put("email", address(email)).put("user", singleLine(user, 254)).put("password", password)
                .put("imap", host(imap)).put("imapPort", port(imapPort)).put("smtp", host(smtp))
                .put("smtpPort", port(smtpPort)).put("implicit", implicit);
    }

    static JSONObject accountById(JSONObject state, String id) throws Exception {
        JSONArray accounts = state.getJSONArray("accounts");
        for (int i = 0; i < accounts.length(); i++) if (id.equals(accounts.getJSONObject(i).getString("id"))) return accounts.getJSONObject(i);
        throw new IllegalArgumentException("Choose an existing account.");
    }

    static void validateDraft(JSONObject state, JSONObject draft) throws Exception {
        accountById(state, draft.getString("account"));
        address(draft.getString("to"));
        singleLine(draft.getString("subject"), 998);
        if (draft.optString("body").trim().isEmpty() || draft.getString("body").length() > MAX_TEXT)
            throw new IllegalArgumentException("Enter a message of at most 65,536 characters.");
    }

    static void saveDraft(JSONObject state, JSONObject draft) throws Exception {
        if (state.getBoolean("pending")) throw new IllegalStateException("Delivery is uncertain. This draft is locked.");
        state.put("draft", copy(draft));
    }

    static void beginSend(JSONObject state) throws Exception {
        if (state.getBoolean("pending")) throw new IllegalStateException("This message may already have been sent.");
        validateDraft(state, state.getJSONObject("draft"));
        state.put("pending", true);
    }

    static void completeSend(JSONObject state, JSONObject sent) throws Exception {
        if (!state.getBoolean("pending") || !state.getJSONObject("draft").toString().equals(sent.toString()))
            throw new IllegalStateException("The outgoing draft changed.");
        state.put("draft", new JSONObject()).put("pending", false);
    }
}
