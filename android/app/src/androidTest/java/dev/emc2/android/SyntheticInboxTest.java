package dev.emc2.android;

import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Installs synthetic data only into a fresh debug profile for Device Hub smoke. Never opens a provider. */
@RunWith(AndroidJUnit4.class)
public class SyntheticInboxTest {
    @Test public void seedFreshDebugProfile() throws Exception {
        MailApp app = (MailApp) InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
        assertTrue(app.getPackageName().endsWith(".debug"));
        CountDownLatch ready = new CountDownLatch(1); app.worker.execute(ready::countDown);
        assertTrue(ready.await(10, TimeUnit.SECONDS)); assertNull(app.fatal);
        assertEquals("Use a fresh synthetic profile", 0, app.state().getJSONArray("accounts").length());
        JSONObject account = MailData.account("Synthetic inbox", "reader@example.invalid", "reader@example.invalid", "synthetic-only", "imap.example.invalid", "993", "smtp.example.invalid", "587", false);
        app.vault.change(next -> {
            next.getJSONArray("accounts").put(account);
            next.getJSONArray("messages").put(new JSONObject().put("account", account.getString("id")).put("id", "1:1")
                    .put("from", "Sender <sender@example.invalid>").put("reply", "sender@example.invalid").put("subject", "Offline reading check")
                    .put("date", 0).put("html", true).put("body", "<p>Synthetic cached message.</p><img src='https://example.invalid/pixel'><script>untrusted()</script>").put("truncated", false));
        });
        assertEquals(1, new Vault(app).snapshot().getJSONArray("messages").length());
    }
}
