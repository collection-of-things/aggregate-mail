package dev.emc2.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** All persistent app data is sealed; unreadable data is never replaced. */
final class Vault {
    private static final byte[] MAGIC = new byte[]{'E', 'M', 'C', '2', 1};
    private static final String ALIAS = "emc2-mail-v1";
    private final AtomicFile file;
    private final SecretKey key;
    private JSONObject state;
    interface Change { void apply(JSONObject next) throws Exception; }

    Vault(Context context) throws Exception { this(context, ALIAS); }

    Vault(Context context, String alias) throws Exception {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "mail.sealed"));
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        // Include an AtomicFile recovery backup when deciding whether a profile already exists.
        boolean existing = file.getBaseFile().exists() || new File(file.getBaseFile() + ".bak").exists();
        if (!keys.containsAlias(alias)) {
            if (existing) throw new IllegalStateException("The encryption key is unavailable. Existing data was preserved.");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
            generator.generateKey();
        }
        key = (SecretKey) keys.getKey(alias, null);
        if (existing) {
            byte[] sealed;
            try (var input = file.openRead()) { sealed = MailTransport.limited(input, MailData.MAX_SNAPSHOT + 33, Long.MAX_VALUE); }
            if (sealed.length < 33 || sealed.length > MailData.MAX_SNAPSHOT + 33) throw new IllegalStateException("Invalid encrypted data.");
            ByteBuffer buffer = ByteBuffer.wrap(sealed);
            for (byte expected : MAGIC) if (buffer.get() != expected) throw new IllegalStateException("Unsupported encrypted data.");
            byte[] iv = new byte[12]; buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()]; buffer.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv)); cipher.updateAAD(MAGIC);
            state = new JSONObject(new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8));
            if (state.getInt("version") != 1) throw new IllegalStateException("Unsupported data version.");
        } else {
            state = MailData.empty();
            write(state);
        }
    }

    synchronized JSONObject snapshot() throws Exception { return MailData.copy(state); }

    synchronized void change(Change change) throws Exception {
        JSONObject next = MailData.copy(state);
        change.apply(next);
        write(next); // Publish only after the atomic encrypted write succeeds.
        state = next;
    }

    private void write(JSONObject next) throws Exception {
        byte[] plain = next.toString().getBytes(StandardCharsets.UTF_8);
        if (plain.length > MailData.MAX_SNAPSHOT) throw new IllegalStateException("The encrypted cache is full. Remove an account first.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(MAGIC);
        byte[] encrypted = cipher.doFinal(plain);
        ByteBuffer sealed = ByteBuffer.allocate(MAGIC.length + 12 + encrypted.length);
        sealed.put(MAGIC).put(cipher.getIV()).put(encrypted);
        FileOutputStream output = file.startWrite();
        try {
            output.write(sealed.array()); output.getFD().sync(); file.finishWrite(output);
            try (var input = file.openRead()) {
                byte[] committed = MailTransport.limited(input, MailData.MAX_SNAPSHOT + 33, Long.MAX_VALUE);
                if (!java.util.Arrays.equals(sealed.array(), committed)) throw new IllegalStateException("Encrypted write did not commit.");
            }
        }
        catch (Exception error) { file.failWrite(output); throw error; }
    }
}
