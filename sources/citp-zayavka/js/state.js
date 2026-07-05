export const state = {
  templateFile:  null,
  dbData:        [],   // [{ fio, login, role, system }] — оригинальные записи
  dbNormalized:  [],   // [{ normFio, login, role, system }] — предвычислено при загрузке
  certFiles:     [],
};
