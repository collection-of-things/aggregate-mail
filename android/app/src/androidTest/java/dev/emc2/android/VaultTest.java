package dev.emc2.android;

import android.content.Context;
import android.content.ContextWrapper;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.UUID;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class VaultTest {
    @Test public void encryptsRecoversAndRejectsTamperAndLostKey() throws Exception {
        Context base = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File dir = new File(base.getNoBackupFilesDir(), UUID.randomUUID().toString()); assertTrue(dir.mkdirs());
        Context context = new ContextWrapper(base) { @Override public File getNoBackupFilesDir() { return dir; } };
        String alias = "emc2-test-" + UUID.randomUUID();
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        File sealed = new File(dir, "mail.sealed");
        try {
            Vault vault = new Vault(context, alias);
            vault.change(next -> next.put("test", "synthetic-private-text"));
            JSONObject account = MailData.account("Synthetic", "sender@example.invalid", "sender", "synthetic-only", "imap.example.invalid", "993", "smtp.example.invalid", "587", false);
            vault.change(next -> {
                next.getJSONArray("accounts").put(account);
                MailData.saveDraft(next, new JSONObject().put("account", account.getString("id"))
                        .put("to", "recipient@example.invalid").put("subject", "Synthetic").put("body", "Pending message"));
                MailData.beginSend(next);
            });
            assertTrue(new Vault(context, alias).snapshot().getBoolean("pending"));
            assertThrows(Exception.class, () -> vault.change(next -> MailData.saveDraft(next, new JSONObject())));
            byte[] encrypted = Files.readAllBytes(sealed.toPath());
            assertFalse(new String(encrypted, StandardCharsets.ISO_8859_1).contains("synthetic-private-text"));
            assertEquals("synthetic-private-text", new Vault(context, alias).snapshot().getString("test"));
            assertThrows(Exception.class, () -> vault.change(next -> { next.put("test", "changed"); throw new Exception("abort"); }));
            assertEquals("synthetic-private-text", vault.snapshot().getString("test"));
            byte[] tampered = encrypted.clone(); tampered[tampered.length - 1] ^= 1; Files.write(sealed.toPath(), tampered);
            assertThrows(Exception.class, () -> new Vault(context, alias));
            assertArrayEquals(tampered, Files.readAllBytes(sealed.toPath()));
            Files.write(sealed.toPath(), encrypted); keys.deleteEntry(alias);
            assertThrows(Exception.class, () -> new Vault(context, alias));
            assertFalse(keys.containsAlias(alias)); assertArrayEquals(encrypted, Files.readAllBytes(sealed.toPath()));
        } finally {
            if (keys.containsAlias(alias)) keys.deleteEntry(alias);
            for (File file : dir.listFiles()) assertTrue(file.delete());
            assertTrue(dir.delete());
        }
    }
}
