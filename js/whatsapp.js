import { supabase } from "./supabase.js";
import { APP_CONFIG } from "./config.js";
import { formatMoney } from "./formatters.js";
import { normalizePhone } from "./utils.js";

export function buildWhatsAppUrl(phone, message) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error("El teléfono no es válido para WhatsApp.");
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function buildPhotoSessionMessage(data) {
  return `Hola ${data.clientName} 👋

Tu galería ya está lista:

📸 Trabajo: ${data.jobTitle}
📦 Paquete: ${data.packageName || "Sin paquete"}
🔗 Ver fotos: ${data.galleryUrl || "Link pendiente"}

Para autorizar la impresión, entra aquí:
${data.approvalUrl}

Resumen:
Precio: ${formatMoney(data.price)}
Abonado: ${formatMoney(data.totalDeposited)}
Pendiente: ${formatMoney(data.remainingBalance)}

IMPORTANTE:
Una vez autorizado el trabajo para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá costo extra.

Por favor revise cuidadosamente antes de aprobar.

Gracias.`;
}

export function buildSchoolGraduationMessage(data) {
  return `Hola ${data.contactName} 👋

Ya está lista la revisión de la graduación:

🏫 Escuela: ${data.schoolName}
🎓 Trabajo: ${data.jobTitle}
👩‍🏫 Maestra: ${data.teacherName || "No registrada"}
👩‍💼 Directora: ${data.principalName || "No registrada"}
📦 Paquete: ${data.packageName || "Sin paquete"}
🧾 Cantidad de paquetes: ${data.packageQuantity}

Links para revisar:
📸 Galería de alumnos: ${data.studentGalleryUrl || "Pendiente"}
👥 Foto grupal: ${data.groupPhotoUrl || "Pendiente"}
📁 Documentación: ${data.documentationUrl || "Pendiente"}
🎓 Diploma: ${data.diplomaUrl || "Pendiente"}

Para autorizar la impresión, entra aquí:
${data.approvalUrl}

Resumen:
Total: ${formatMoney(data.price)}
Abonado: ${formatMoney(data.totalDeposited)}
Pendiente: ${formatMoney(data.remainingBalance)}

IMPORTANTE:
Revise cuidadosamente nombres, fotos, cantidades, diploma, documentación y diseño antes de aprobar.

Una vez autorizado para impresión, cualquier cambio adicional solicitado después de la aprobación tendrá costo extra.

Gracias.`;
}

export async function generateAndLogWhatsAppMessage(jobId, phone) {
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*, clients(*, school_profiles(*)), packages(*), galleries(*), deposits(*)")
    .eq("id", jobId)
    .single();
  if (error) throw error;

  const deposits = job.deposits || [];
  const totalDeposited = deposits.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const remainingBalance = Math.max(Number(job.price || 0) - totalDeposited, 0);
  const approvalUrl = `${APP_CONFIG.appUrl.replace(/\/$/, "")}/approval.html?token=${job.approval_token}`;
  const active = (type) => (job.galleries || []).find((gallery) => gallery.gallery_type === type && gallery.is_active)?.google_photos_url || "";
  const school = job.clients.school_profiles?.[0] || {};
  const message = job.job_type === "SCHOOL_GRADUATION"
    ? buildSchoolGraduationMessage({
        contactName: job.clients.name,
        schoolName: school.school_name || job.clients.name,
        jobTitle: job.title,
        teacherName: school.teacher_name,
        principalName: school.principal_name,
        packageName: job.packages?.name,
        packageQuantity: job.package_quantity,
        studentGalleryUrl: active("STUDENT_GALLERY"),
        groupPhotoUrl: active("GROUP_PHOTO"),
        documentationUrl: active("DOCUMENTATION_FOLDER"),
        diplomaUrl: active("DIPLOMA"),
        approvalUrl,
        price: job.price,
        totalDeposited,
        remainingBalance
      })
    : buildPhotoSessionMessage({
        clientName: job.clients.name,
        jobTitle: job.title,
        packageName: job.packages?.name,
        galleryUrl: active("GENERAL"),
        approvalUrl,
        price: job.price,
        totalDeposited,
        remainingBalance
      });

  const waMeUrl = buildWhatsAppUrl(phone || job.clients.phone, message);
  await supabase.from("message_logs").insert({
    job_id: job.id,
    client_id: job.client_id,
    message_type: "GALLERY_LINK",
    message_text: message,
    wa_me_url: waMeUrl
  });
  await supabase.from("galleries").update({ sent_at: new Date().toISOString() }).eq("job_id", job.id).eq("is_active", true);
  await supabase.from("jobs").update({ status: "WAITING_APPROVAL" }).eq("id", job.id);
  return { message, waMeUrl };
}
