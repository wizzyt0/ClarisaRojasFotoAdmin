export const CLIENT_TYPES = {
  SCHOOL_GRADUATION: "Escuela",
  PHOTO_SESSION: "Particular"
};

export const JOB_TYPES = {
  SCHOOL_GRADUATION: "Escuela",
  PHOTO_SESSION: "Particular"
};

export const SCHOOL_EVENT_TYPES = {
  GRADUATION: "Graduación",
  MEMORY: "Fotografía de recuerdo",
  CHRISTMAS: "Fotografía navideña"
};

export const SCHOOL_EVENT_PACKAGE_TYPES = {
  GRADUATION: "SCHOOL_GRADUATION",
  MEMORY: "SCHOOL_MEMORY",
  CHRISTMAS: "SCHOOL_CHRISTMAS"
};

export const JOB_STATUSES = {
  CREATED: "Creado",
  EDITING: "En edición",
  GALLERY_READY: "Galería lista",
  GALLERY_SENT: "Galería enviada",
  WAITING_APPROVAL: "Esperando aprobación",
  CHANGES_REQUESTED: "Cambios solicitados",
  APPROVED_FOR_PRINT: "Aprobado para imprimir",
  PRINTING: "En impresión",
  READY_FOR_DELIVERY: "Listo para entregar",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado"
};

export const GALLERY_TYPES = {
  GENERAL: "General",
  STUDENT_GALLERY: "Galería de alumnos",
  GROUP_PHOTO: "Foto grupal",
  DOCUMENTATION_FOLDER: "Carpeta de documentación",
  DIPLOMA: "Diploma",
  OTHER: "Otro"
};

export const FOLLOW_UP_STATUSES = {
  NEW_CONTACT: "Nuevo contacto",
  CONTACT_NEXT_YEAR: "Contactar próximo año",
  INTERESTED: "Interesado",
  QUOTE_SENT: "Cotización enviada",
  CONFIRMED: "Confirmado",
  NOT_INTERESTED: "No interesado",
  RECURRING_CLIENT: "Cliente recurrente"
};

export const PACKAGE_TYPES = {
  GENERAL: "General",
  PHOTO_SESSION: "Particular",
  SCHOOL_GRADUATION: "Graduación escolar",
  SCHOOL_MEMORY: "Fotografía de recuerdo",
  SCHOOL_CHRISTMAS: "Fotografía navideña"
};

const label = (map, value) => map[value] || value || "";

export const getClientTypeLabel = (value) => label(CLIENT_TYPES, value);
export const getJobTypeLabel = (value) => label(JOB_TYPES, value);
export const getJobStatusLabel = (value) => label(JOB_STATUSES, value);
export const getGalleryTypeLabel = (value) => label(GALLERY_TYPES, value);
export const getFollowUpStatusLabel = (value) => label(FOLLOW_UP_STATUSES, value);
export const getPackageTypeLabel = (value) => label(PACKAGE_TYPES, value);
export const getSchoolEventTypeLabel = (value) => label(SCHOOL_EVENT_TYPES, value);
