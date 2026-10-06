import { prisma } from "./prisma.js";
import { resolveTemplateContext } from "./phase3.js";

/**
 * Send a WhatsApp template message using Meta Cloud API.
 */
export async function sendMetaWhatsAppMessage({ salonId, branchId, to, templateName, components = [], languageCode = "en" }) {
  const settings = await prisma.whatsAppSetting.findFirst({
    where: { salonId } // ignore branchId for global config fallback
  });

  const phoneNumberId = settings?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = settings?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    console.log("WhatsApp Cloud API credentials not configured for salon:", salonId);
    return null;
  }

  let metaTemplateName = templateName;
  if (settings?.templates && typeof settings.templates === 'object') {
    metaTemplateName = settings.templates[templateName] || templateName;
  }

  const apiVersion = process.env.WHATSAPP_API_VERSION || "v20.0";
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const formattedPhone = to.replace(/[^0-9]/g, "");

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formattedPhone,
    type: "template",
    template: {
      name: metaTemplateName,
      language: { code: languageCode },
      components
    }
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (!res.ok) {
      console.error("[WhatsApp API Error Response]:", data);
      throw new Error(data?.error?.message || "Failed to send WhatsApp message");
    }
    
    console.log(`[WhatsApp API] Message sent to ${formattedPhone} via ${metaTemplateName}`);
    return data;
  } catch (error) {
    console.error("[WhatsApp API Error]:", error.message);
    throw error;
  }
}

/**
 * Higher level function to resolve context, build Meta components, and send.
 */
export async function dispatchWhatsAppTemplate({ salonId, branchId, to, templateType, contextPayload }) {
  try {
    if (!to) return null;
    
    // Resolve standard variables
    const variables = await resolveTemplateContext(salonId, contextPayload);
    const customerName = variables.customer_name || variables.customerName || variables.name || "Valued Customer";
    const salonName = variables.salon_name || variables.salonName || "Styluxe";
    const apptDateTime = variables.appointment_date_time || variables.appointmentDateTime || "your scheduled time";
    const invoiceAmount = variables.invoice_amount || variables.invoiceAmount || "0.00";
    const membershipExpiry = variables.membership_expiry || variables.membershipExpiry || "soon";
    const packageBalance = variables.package_balance != null ? String(variables.package_balance) : (variables.packageBalance != null ? String(variables.packageBalance) : "0");
    
    let normalizedType = templateType;
    let parameters = [];

    if (normalizedType === "appointment_confirmation") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: apptDateTime }
      ];
    } else if (normalizedType === "invoice_template" || normalizedType === "payment_receipt_template") {
      normalizedType = "invoice_template";
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: invoiceAmount },
        { type: "text", text: apptDateTime }
      ];
    } else if (normalizedType === "appointment_reminder") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: apptDateTime }
      ];
    } else if (normalizedType === "membership_activation_template" || normalizedType === "membership_purchase_template") {
      normalizedType = "membership_activation_template";
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: membershipExpiry }
      ];
    } else if (normalizedType === "membership_expiry_template") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: membershipExpiry }
      ];
    } else if (normalizedType === "package_purchase_template") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: packageBalance }
      ];
    } else if (normalizedType === "google_review_feedback" || normalizedType === "feedback_follow_up" || normalizedType === "feedback_request_template") {
      normalizedType = "google_review_feedback";
      parameters = [
        { type: "text", text: customerName }
      ];
    }

    const components = parameters.length > 0 ? [{ type: "body", parameters }] : [];

    return await sendMetaWhatsAppMessage({
      salonId,
      branchId,
      to,
      templateName: normalizedType,
      components,
      languageCode: "en"
    });
  } catch (err) {
    console.error("[dispatchWhatsAppTemplate] Error:", err.message);
    return null;
  }
}
