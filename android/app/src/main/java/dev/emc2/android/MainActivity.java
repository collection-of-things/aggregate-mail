package dev.emc2.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.graphics.Color;
import android.text.Editable;
import android.text.Html;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;

/** Native text-only surfaces. Sender HTML never enters a browser or loads remote content. */
public final class MainActivity extends Activity {
    private MailApp app;
    private LinearLayout root, content;
    private TextView status, saveStatus;
    private EditText to, subject, body;
    private Spinner from;
    private String page = "inbox", selectedAccount = "";
    private JSONObject selectedMail;
    String notice = "";
    private final ArrayList<String> accountIds = new ArrayList<>();

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        app = (MailApp) getApplication(); app.screen = this;
        // View state holds credentials and drafts. Never put it in Android's saved-state parcel.
        if (app.editingDraft != null && app.editingDraft.has("account")) page = "compose";
        if (android.os.Build.VERSION.SDK_INT >= 33)
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        refresh();
    }

    @Override protected void onPause() { super.onPause(); app.saveDraft(); }
    @Override protected void onDestroy() { if (app.screen == this) app.screen = null; super.onDestroy(); }
    @Override public boolean onKeyUp(int key, android.view.KeyEvent event) {
        if (android.os.Build.VERSION.SDK_INT < 33 && key == android.view.KeyEvent.KEYCODE_BACK) { goBack(); return true; }
        return super.onKeyUp(key, event);
    }
    private void goBack() {
        if (app.busy) return;
        if (page.equals("compose")) app.saveDraft();
        if (!page.equals("inbox")) { page = "inbox"; notice = ""; refresh(); }
        else finish();
    }

    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size);
        view.setTextColor(Color.rgb(235,235,239)); view.setPadding(0, dp(6), 0, dp(6));
        view.setSaveEnabled(false); return view;
    }
    private Button button(LinearLayout parent, String label, Runnable action) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setMinHeight(dp(48));
        view.setOnClickListener(v -> { if (!app.busy) action.run(); }); parent.addView(view); return view;
    }
    private LinearLayout row(LinearLayout parent) {
        LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); parent.addView(row); return row;
    }
    private EditText field(String label, String value, int type, int maximum) {
        content.addView(text(label, 13));
        EditText view = new EditText(this); view.setText(value); view.setTextSize(16);
        view.setContentDescription(label); view.setInputType(type); view.setSingleLine(true);
        view.setFilters(new InputFilter[]{new InputFilter.LengthFilter(maximum)});
        view.setSaveEnabled(false); view.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        view.setMinHeight(dp(48)); content.addView(view); return view;
    }
    void setBusy() { enable(root, false); if (status != null) status.setText("Working…"); }
    private void enable(View view, boolean value) {
        view.setEnabled(value);
        if (view instanceof android.view.ViewGroup group)
            for (int i = 0; i < group.getChildCount(); i++) enable(group.getChildAt(i), value);
    }

    void refresh() {
        if (isDestroyed()) return;
        saveStatus = null;
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(14,14,16)); root.setPadding(dp(16), 0, dp(16), 0);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(dp(16) + insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    dp(16) + insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets;
        });
        setContentView(root);
        root.addView(text("Emc²", 24));
        status = text(notice, 14); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(status);
        ScrollView scroll = new ScrollView(this); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); scroll.addView(content);
        if (app.fatal != null) { status.setText(app.fatal); return; }
        if (app.vault == null) { status.setText("Opening encrypted mail…"); return; }
        try {
            JSONObject state = app.state();
            if (page.equals("account")) accountForm();
            else if (page.equals("accounts")) accounts(state);
            else if (page.equals("reader") && selectedMail != null) reader(state);
            else if (page.equals("compose")) composer(state);
            else inbox(state);
        } catch (Exception error) { status.setText("This view could not be opened. Your saved data was preserved."); }
        if (app.busy) setBusy();
    }

    private void inbox(JSONObject state) throws Exception {
        LinearLayout actions = row(content);
        button(actions, "Accounts", () -> { page = "accounts"; refresh(); });
        if (state.getJSONArray("accounts").length() == 0) {
            content.addView(text("Your mail, on this device", 22));
            content.addView(text("Connect an IMAP account to read cached mail offline and send with SMTP. No desktop app is needed.", 16));
            button(content, "Add account", () -> { page = "account"; refresh(); }); return;
        }
        button(actions, "Sync", this::sync);
        button(actions, "Compose", () -> { page = "compose"; refresh(); });
        content.addView(text("Inbox", 22));
        content.addView(text("Up to 100 recent messages per account. Sync is manual; cached mail may be out of date.", 13));
        JSONArray accounts = state.getJSONArray("accounts");
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject a = accounts.getJSONObject(i);
            long synced = a.optLong("synced");
            content.addView(text(a.getString("label") + ": " + (synced == 0 ? "Not yet synced" : "Last synced " + date(synced)), 13));
        }
        ArrayList<JSONObject> messages = new ArrayList<>();
        JSONArray cache = state.getJSONArray("messages");
        for (int i = 0; i < cache.length(); i++) messages.add(cache.getJSONObject(i));
        messages.sort(Comparator.comparingLong((JSONObject m) -> m.optLong("date")).reversed());
        if (messages.isEmpty()) content.addView(text("No cached messages. Tap Sync to fetch your inbox.", 16));
        for (JSONObject mail : messages) {
            String account = MailData.accountById(state, mail.getString("account")).getString("label");
            Button message = button(content, mail.getString("from") + "\n" + mail.getString("subject") + "\n" + account + " · " + date(mail.optLong("date")), () -> {
                selectedMail = mail; page = "reader"; refresh();
            });
            message.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL);
        }
        if (state.getBoolean("pending")) content.addView(text("A message has uncertain delivery. Open Compose to review the locked draft.", 16));
        else if (state.getJSONObject("draft").has("account")) content.addView(text("A saved draft is available in Compose.", 13));
    }

    private String date(long value) { return value == 0 ? "Unknown date" : DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(value)); }

    private void sync() {
        app.job(() -> {
            JSONArray accounts = app.state().getJSONArray("accounts");
            boolean failed = false;
            for (int i = 0; i < accounts.length(); i++) {
                JSONObject a = accounts.getJSONObject(i);
                try {
                    JSONArray mail = MailTransport.inbox(a);
                    app.vault.change(next -> {
                        JSONArray kept = new JSONArray();
                        JSONArray previous = next.getJSONArray("messages");
                        for (int j = 0; j < previous.length(); j++)
                            if (!previous.getJSONObject(j).getString("account").equals(a.getString("id"))) kept.put(previous.getJSONObject(j));
                        for (int j = 0; j < mail.length(); j++) kept.put(mail.getJSONObject(j));
                        next.put("messages", kept);
                        MailData.accountById(next, a.getString("id")).put("synced", System.currentTimeMillis());
                    });
                } catch (Exception error) { failed = true; }
            }
            if (failed) throw new IllegalStateException("Partial sync");
        }, "Inbox synced.", "Some accounts could not sync. Their previous cache was kept. Check network, app passwords and the 256 KiB message limit.", ok -> { });
    }

    private void accounts(JSONObject state) throws Exception {
        button(content, "Back to inbox", () -> { page = "inbox"; refresh(); });
        content.addView(text("Accounts", 22));
        JSONArray accounts = state.getJSONArray("accounts");
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject a = accounts.getJSONObject(i);
            content.addView(text(a.getString("label") + "\n" + a.getString("email"), 16));
            button(content, "Remove " + a.getString("label"), () -> new AlertDialog.Builder(this)
                    .setTitle("Remove this account?").setMessage("This deletes its local cache and any draft for this account. Mail on the server is unchanged. Removing a draft cannot undo a delivery.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Remove", (d,w) -> removeAccount(a)).show());
        }
        if (accounts.length() < MailData.MAX_ACCOUNTS) button(content, "Add account", () -> { page = "account"; refresh(); });
        content.addView(text("Credentials and mail stay in encrypted storage on this device. Android backup is disabled. Gmail OAuth is not available in this version.", 14));
    }

    private void removeAccount(JSONObject account) {
        app.job(() -> app.vault.change(next -> {
            String id = account.getString("id");
            for (String field : new String[]{"accounts", "messages"}) {
                JSONArray previous = next.getJSONArray(field), kept = new JSONArray();
                for (int i = 0; i < previous.length(); i++) {
                    JSONObject value = previous.getJSONObject(i);
                    if (!id.equals(value.getString(field.equals("accounts") ? "id" : "account"))) kept.put(value);
                }
                next.put(field, kept);
            }
            if (id.equals(next.getJSONObject("draft").optString("account"))) next.put("draft", new JSONObject()).put("pending", false);
        }), "Account removed from this device.", "Account could not be removed. Saved data was preserved.", ok -> {
            if (ok && app.editingDraft != null && account.optString("id").equals(app.editingDraft.optString("account"))) {
                app.main.removeCallbacks(app.autosave);
                app.editingDraft = new JSONObject(); app.draftDirty = false; app.draftRevision++;
            }
        });
    }

    private void accountForm() {
        button(content, "Cancel", () -> { page = "accounts"; refresh(); });
        content.addView(text("Add IMAP account", 22));
        content.addView(text("Use your provider's IMAP and SMTP settings and an app password when required. Both servers must support verified TLS. The same login is used for both.", 14));
        EditText label = field("Account name", "", InputType.TYPE_CLASS_TEXT, 100);
        EditText email = field("Email", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 254);
        EditText user = field("Login name", "", InputType.TYPE_CLASS_TEXT, 254);
        EditText password = field("App password", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD, 1024);
        EditText imap = field("IMAP hostname", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI, 253);
        EditText imapPort = field("IMAP TLS port", "993", InputType.TYPE_CLASS_NUMBER, 5);
        EditText smtp = field("SMTP hostname", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI, 253);
        EditText smtpPort = field("SMTP port", "587", InputType.TYPE_CLASS_NUMBER, 5);
        CheckBox implicit = new CheckBox(this); implicit.setText("SMTP uses implicit TLS (usually port 465)"); content.addView(implicit);
        content.addView(text("Otherwise SMTP requires STARTTLS, usually on port 587. Saving an account does not connect it; use Sync to test receiving. Sending is a separate operation.", 13));
        button(content, "Save account", () -> {
            try {
                JSONObject account = MailData.account(label.getText().toString(), email.getText().toString(), user.getText().toString(),
                        password.getText().toString(), imap.getText().toString(), imapPort.getText().toString(),
                        smtp.getText().toString(), smtpPort.getText().toString(), implicit.isChecked());
                app.job(() -> app.vault.change(next -> {
                    JSONArray accounts = next.getJSONArray("accounts");
                    if (accounts.length() >= MailData.MAX_ACCOUNTS) throw new IllegalStateException("Account limit reached");
                    accounts.put(account);
                }), "Account saved. Tap Sync to connect.", "Account could not be saved. Existing data was preserved.", ok -> { if (ok) page = "inbox"; });
            } catch (Exception error) { status.setText("Check all fields. Enter one valid email, hostnames without URLs, ports from 1 to 65535, and an app password."); }
        });
    }

    private void reader(JSONObject state) throws Exception {
        button(content, "Back to inbox", () -> { page = "inbox"; refresh(); });
        content.addView(text(selectedMail.getString("subject"), 22));
        content.addView(text(selectedMail.getString("from"), 16));
        content.addView(text(MailData.accountById(state, selectedMail.getString("account")).getString("label") + " · " + date(selectedMail.optLong("date")), 13));
        String raw = selectedMail.getString("body");
        String plain = selectedMail.optBoolean("html") ? Html.fromHtml(raw, Html.FROM_HTML_MODE_LEGACY).toString() : raw;
        TextView message = text(plain, 17); message.setTextIsSelectable(true); content.addView(message);
        content.addView(text("Text-only cached copy. Remote images and attachments are never loaded. Opening this copy does not mark server mail read."
                + (selectedMail.optBoolean("truncated") ? " This text was truncated." : ""), 13));
        button(content, "Reply", () -> {
            try {
                if (app.editingDraft.has("account") || app.state().getBoolean("pending")) {
                    notice = "An existing draft must be sent or discarded first."; page = "compose"; refresh(); return;
                }
                String title = selectedMail.getString("subject");
                app.changedDraft(new JSONObject().put("account", selectedMail.getString("account"))
                        .put("to", selectedMail.optString("reply")).put("subject", title.startsWith("Re:") ? title : "Re: " + title).put("body", ""));
                page = "compose"; refresh();
            } catch (Exception error) { status.setText("Reply could not be opened."); }
        });
    }

    private void composer(JSONObject state) throws Exception {
        JSONArray accounts = state.getJSONArray("accounts");
        if (accounts.length() == 0) { page = "account"; accountForm(); return; }
        button(content, "Back to inbox", () -> { app.saveDraft(); page = "inbox"; refresh(); });
        content.addView(text("New message", 22));
        boolean pending = state.getBoolean("pending");
        JSONObject draft = app.editingDraft == null ? state.getJSONObject("draft") : app.editingDraft;
        accountIds.clear(); ArrayList<String> labels = new ArrayList<>();
        int selected = 0;
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject account = accounts.getJSONObject(i); accountIds.add(account.getString("id")); labels.add(account.getString("label"));
            if (account.getString("id").equals(draft.optString("account"))) selected = i;
        }
        selectedAccount = accountIds.get(selected);
        content.addView(text("From", 13));
        from = new Spinner(this); from.setContentDescription("Sending account"); from.setSaveEnabled(false);
        from.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels));
        from.setSelection(selected); content.addView(from);
        to = field("To", draft.optString("to"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, 254);
        subject = field("Subject", draft.optString("subject"), InputType.TYPE_CLASS_TEXT, 998);
        body = field("Message", draft.optString("body"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, MailData.MAX_TEXT);
        body.setSingleLine(false); body.setMinLines(6); body.setGravity(android.view.Gravity.TOP);
        saveStatus = text(app.draftDirty ? "Draft not yet saved" : draft.has("account") ? "Draft saved on this device" : "No saved draft", 13); content.addView(saveStatus);
        content.addView(text("One recipient. Plain text only. This app does not save a Sent copy; your SMTP provider may do so.", 13));
        if (pending) {
            content.addView(text("Delivery is uncertain. This message may already have been delivered. Check your provider before discarding this locked draft. It will never retry automatically.", 16));
            from.setEnabled(false); to.setEnabled(false); subject.setEnabled(false); body.setEnabled(false);
        } else {
            TextWatcher watcher = new TextWatcher() {
                public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
                public void onTextChanged(CharSequence s, int start, int before, int count) { captureDraft(); }
                public void afterTextChanged(Editable e) { }
            };
            to.addTextChangedListener(watcher); subject.addTextChangedListener(watcher); body.addTextChangedListener(watcher);
            from.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                public void onNothingSelected(AdapterView<?> parent) { }
                public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                    if (!selectedAccount.equals(accountIds.get(position))) { selectedAccount = accountIds.get(position); captureDraft(); }
                }
            });
            button(content, "Send", this::confirmSend);
        }
        button(content, "Discard draft", () -> new AlertDialog.Builder(this).setTitle("Discard this draft?")
                .setMessage(pending ? "This removes the delivery warning and draft. It cannot undo a message that was already sent. Check your provider first." : "This deletes the locally saved message.")
                .setNegativeButton("Keep", null).setPositiveButton("Discard", (d,w) -> discard()).show());
    }

    private JSONObject draftFields() throws Exception {
        return new JSONObject().put("account", selectedAccount).put("to", to.getText().toString())
                .put("subject", subject.getText().toString()).put("body", body.getText().toString());
    }
    private void captureDraft() {
        if (app.busy) return;
        try { app.changedDraft(draftFields()); draftStatus(false); } catch (Exception ignored) { }
    }
    void saveFailed() {
        notice = "Draft save failed. Keep this app open and return to Compose to preserve your text.";
        if (status != null) status.setText(notice);
    }
    void draftStatus(boolean saved) {
        if (saveStatus != null) saveStatus.setText(saved ? "Draft saved on this device" : "Draft not yet saved. Keep this app open if saving fails.");
    }
    private void confirmSend() {
        try {
            JSONObject draft = draftFields(); MailData.validateDraft(app.state(), draft);
            new AlertDialog.Builder(this).setTitle("Send this message?").setMessage("Send to " + draft.getString("to") + "?")
                    .setNegativeButton("Cancel", null).setPositiveButton("Send", (d,w) -> send(draft)).show();
        } catch (Exception error) { status.setText("Choose an account, one valid recipient, a subject and message before sending."); }
    }
    private void send(JSONObject draft) {
        app.main.removeCallbacks(app.autosave);
        app.job(() -> {
            app.vault.change(next -> { MailData.saveDraft(next, draft); MailData.beginSend(next); });
            JSONObject account = MailData.accountById(app.state(), draft.getString("account"));
            MailTransport.send(account, draft);
            app.vault.change(next -> MailData.completeSend(next, draft));
        }, "Message accepted by the SMTP server. This app did not save a Sent copy.",
                "Send did not finish safely. If delivery is uncertain, the draft is locked. Do not resend without checking your provider.", ok -> {
                    try {
                        JSONObject state = app.state();
                        if (ok || state.getBoolean("pending")) { app.editingDraft = state.getJSONObject("draft"); app.draftDirty = false; app.draftRevision++; }
                    } catch (Exception ignored) { }
                    if (ok && app.screen != null) app.screen.page = "inbox";
                });
    }
    private void discard() {
        app.main.removeCallbacks(app.autosave);
        app.job(() -> app.vault.change(next -> next.put("draft", new JSONObject()).put("pending", false)),
                "Draft discarded.", "Draft could not be discarded. Saved data was preserved.", ok -> {
                    if (ok) { app.editingDraft = new JSONObject(); app.draftDirty = false; app.draftRevision++;
                        if (app.screen != null) app.screen.page = "inbox"; }
                });
    }
}
