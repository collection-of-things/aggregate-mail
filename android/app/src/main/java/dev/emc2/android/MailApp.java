package dev.emc2.android;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One writer survives Activity recreation. Never export state through intents or saved-instance bundles. */
public final class MailApp extends Application {
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    final Handler main = new Handler(Looper.getMainLooper());
    Vault vault;
    String fatal;
    JSONObject editingDraft;
    long draftRevision;
    boolean draftDirty;
    final Runnable autosave = this::saveDraft;

    void changedDraft(JSONObject draft) {
        editingDraft = draft;
        draftRevision++;
        draftDirty = true;
        main.removeCallbacks(autosave);
        main.postDelayed(autosave, 500);
    }

    void saveDraft() {
        main.removeCallbacks(autosave);
        if (editingDraft == null || !draftDirty || fatal != null || busy) return;
        final JSONObject draft;
        final long revision = draftRevision;
        try { draft = MailData.copy(editingDraft); } catch (Exception error) { return; }
        worker.execute(() -> {
            boolean saved = false;
            try { vault.change(next -> MailData.saveDraft(next, draft)); saved = true; }
            catch (Exception ignored) { }
            boolean result = saved;
            main.post(() -> {
                if (revision == draftRevision) draftDirty = !result;
                if (screen != null) {
                    screen.draftStatus(result && revision == draftRevision);
                    if (!result) screen.saveFailed();
                }
            });
        });
    }
    volatile boolean busy;
    interface Job { void run() throws Exception; }
    interface Done { void run(boolean success); }
    MainActivity screen;

    @Override public void onCreate() {
        super.onCreate();
        busy = true;
        worker.execute(() -> {
            try { vault = new Vault(this); editingDraft = vault.snapshot().getJSONObject("draft"); }
            catch (Exception error) { fatal = "Encrypted storage cannot be opened. Your data was preserved. No key or profile was reset."; }
            main.post(() -> { busy = false; if (screen != null) screen.refresh(); });
        });
    }

    void job(Job job, String success, String failure, Done done) {
        if (busy || fatal != null) return;
        busy = true;
        if (screen != null) screen.setBusy();
        worker.execute(() -> {
            boolean ok = false;
            try { job.run(); ok = true; } catch (Exception ignored) { /* Never expose provider errors or credentials. */ }
            boolean result = ok;
            main.post(() -> {
                busy = false;
                if (screen != null) screen.notice = result ? success : failure;
                done.run(result);
                if (screen != null) screen.refresh();
            });
        });
    }

    JSONObject state() throws Exception { return vault.snapshot(); }
}
