// Save everything before the external repair helper requests a normal exit.
// Never close documents here: a cancelled Save As must leave the workspace open.
async function saveRepairDocuments(ps, flush) {
  await ps.core.executeAsModal(async context => {
    const documents = Array.from(ps.app.documents);
    for (const doc of documents) {
      if (context.isCancelled) throw new Error('Enregistrement annulé / Save cancelled');
      if (!doc.saved) await doc.save();
      if (!doc.saved) throw new Error('Document non enregistré / Unsaved document: ' + doc.name);
    }
    if (context.isCancelled || Array.from(ps.app.documents).some(doc => !doc.saved)) {
      throw new Error('Des documents restent non enregistrés / Unsaved documents remain');
    }
    await flush();
  }, { commandName: 'TypeR - Save before repair', interactive: true });
}

module.exports = { saveRepairDocuments };
