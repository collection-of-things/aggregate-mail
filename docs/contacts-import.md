# Import contacts

Open **Contacts** in the sidebar, then **Import contacts**. Export the people
you want from your provider, choose a connected Emc² account, and select the
exported file. Check the preview and choose **Import contacts** to save them.
The provider's address book stays unchanged.

| Source | Export to use |
| --- | --- |
| [Google Contacts](https://support.google.com/contacts/answer/7199294?hl=en), including Gmail contacts | Select contacts, choose Export, then Google CSV or vCard. |
| Yahoo Mail | Open Contacts and export CSV. Menu availability can vary by Yahoo Mail version. |
| Outlook People | Manage contacts, Export contacts, then CSV. |
| [iCloud Contacts](https://support.apple.com/guide/icloud/import-export-and-print-contacts-mmfba748b2/icloud) or Apple Contacts | Select contacts and export vCard. |
| Other address books | UTF-8 vCard or CSV with Google, Yahoo or Outlook-style email columns. |

This method needs no developer account, application registration or paid
service. Sign in only on your provider's own site. Emc² does not ask for the
provider password or read a browser session. Direct Google People API access
requires a Cloud project and OAuth client, as described in
[Google's setup guide](https://developers.google.com/people/quickstart/python).
Mail app passwords are not a universal contacts API credential.

Only names and email addresses are imported. Each email address becomes a saved
contact for the destination account. Existing contacts are kept; duplicate
addresses are compared without case. The preview reports new, already saved,
and invalid or repeated addresses. Contacts without an email are skipped.

Files must be UTF-8 CSV or vCard (`.vcf`), at most 512 KiB and 5000 email
addresses. An account can hold 1000 saved contacts. Choose a smaller export if
the import would exceed that limit. CSV supports quoted commas and doubled
quotes. vCard supports folded lines, escaped punctuation and multiple email
fields. Encoded legacy vCard name/email fields are refused; re-export as UTF-8.
Photos, notes, groups and phone numbers are omitted. File contents are never
executed or used to fetch external resources.

Import is a one-time copy. Later provider edits do not sync automatically.
Repeat an import to add new addresses; existing names are not overwritten.
After an uncertain response, preview again to see what remains. Imported
contacts are encrypted with the existing local store and feed To, Cc and Bcc
suggestions. Disconnecting the destination account removes its contacts.
The Contacts page clears open edits and import previews when connected accounts
change. Privacy hides the find query until you focus its field.

The export you downloaded remains a personal-data file on your computer.
Remove it when you no longer need it. Emc² does not retain that file or its name.
