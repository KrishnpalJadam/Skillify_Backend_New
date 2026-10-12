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

    const settings = await prisma.whatsAppSetting.findFirst({
      where: { salonId }
    });

    let metaTemplateName = templateType;
    if (settings?.templates && typeof settings.templates === 'object') {
      metaTemplateName = settings.templates[templateType] || templateType;
    }
    if (metaTemplateName === "appointment_cancelled" || metaTemplateName === "appointment_cancelled_sty0110") {
      metaTemplateName = "appointment_cancel";
    }
    
    // Resolve standard variables
    const variables = await resolveTemplateContext(salonId, contextPayload);
    const customerName = variables.customer_name || variables.customerName || variables.name || "Valued Customer";
    const salonName = variables.salon_name || variables.salonName || "Styluxe Unisex Salon Alwal";
    const apptDateTime = variables.appointment_date_time || variables.appointmentDateTime || "your scheduled time";
    
    // Clean numeric price formatting
    const rawInvAmount = variables.invoice_amount || variables.invoiceAmount || contextPayload?.total || "0.00";
    const numInvAmount = Number(String(rawInvAmount).replace(/[^0-9.]/g, "")) || 0;
    const invoiceAmount = numInvAmount.toFixed(2);

    const rawOrdAmount = variables.order_amount || variables.orderAmount || "0.00";
    const numOrdAmount = Number(String(rawOrdAmount).replace(/[^0-9.]/g, "")) || 0;
    const orderAmount = numOrdAmount.toFixed(2);

    const membershipExpiry = variables.membership_expiry || variables.membershipExpiry || "soon";
    const packageBalance = variables.package_balance != null ? String(variables.package_balance) : (variables.packageBalance != null ? String(variables.packageBalance) : "0");
    
    let parameters = [];

    // Map according to exact Meta template definition
    if (metaTemplateName === "appointment_confirmation_sty0110") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName },
        { type: "text", parameter_name: "salon_name", text: salonName },
        { type: "text", parameter_name: "appointment_date_time", text: apptDateTime }
      ];
    } else if (metaTemplateName === "appointment_confirmation") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: apptDateTime },
        { type: "text", text: salonName }
      ];
    } else if (metaTemplateName === "invoice_template_sty0110") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName },
        { type: "text", parameter_name: "invoice_amount", text: invoiceAmount },
        { type: "text", parameter_name: "appointment_date_time", text: apptDateTime }
      ];
    } else if (metaTemplateName === "invoice_template" || metaTemplateName === "payment_receipt_template") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: "₹" },
        { type: "text", text: invoiceAmount },
        { type: "text", text: apptDateTime }
      ];
    } else if (metaTemplateName === "appointment_reminder_sty0110") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName },
        { type: "text", parameter_name: "salon_name", text: salonName },
        { type: "text", parameter_name: "appointment_date_time", text: apptDateTime }
      ];
    } else if (metaTemplateName === "appointment_reminder") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: apptDateTime }
      ];
    } else if (metaTemplateName === "appointment_cancel") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: apptDateTime }
      ];
    } else if (metaTemplateName === "appointment_cancelled_sty0110" || metaTemplateName === "appointment_cancelled") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName },
        { type: "text", parameter_name: "appointment_date_time", text: apptDateTime }
      ];
    } else if (metaTemplateName === "membership_activation_template_sty0110") {
      parameters = [
        { type: "text", parameter_name: "customer_name", text: customerName },
        { type: "text", parameter_name: "membership_expiry", text: membershipExpiry }
      ];
    } else if (metaTemplateName === "membership_activation_template" || metaTemplateName === "membership_purchase_template") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: membershipExpiry }
      ];
    } else if (metaTemplateName === "membership_expiry_template_sty0110") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName },
        { type: "text", parameter_name: "membership_expiry", text: membershipExpiry }
      ];
    } else if (metaTemplateName === "package_purchase_template_sty0110") {
      parameters = [
        { type: "text", parameter_name: "customer_name", text: customerName },
        { type: "text", parameter_name: "salon_name", text: salonName },
        { type: "text", parameter_name: "package_balance", text: packageBalance }
      ];
    } else if (metaTemplateName === "package_purchase_template") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: packageBalance }
      ];
    } else if (metaTemplateName === "package_expiry_template_sty0110") {
      parameters = [
        { type: "text", parameter_name: "customer_name", text: customerName },
        { type: "text", parameter_name: "package_balance", text: packageBalance }
      ];
    } else if (metaTemplateName === "customer_welcome") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName },
        { type: "text", parameter_name: "salon_name", text: salonName }
      ];
    } else if (metaTemplateName === "birthday_template") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName }
      ];
    } else if (metaTemplateName === "anniversary_template_sty0110" || metaTemplateName === "anniversary_template") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName }
      ];
    } else if (metaTemplateName === "order_confirmation_sty0110" || metaTemplateName === "order_confirmation") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName },
        { type: "text", parameter_name: "order_number", text: variables.order_number || "ORD-001" },
        { type: "text", parameter_name: "salon_name", text: salonName },
        { type: "text", parameter_name: "order_amount", text: orderAmount }
      ];
    } else if (metaTemplateName === "gmap_review_sty0110") {
      parameters = [
        { type: "text", parameter_name: "name", text: customerName }
      ];
    } else if (metaTemplateName === "google_review_feedback" || metaTemplateName === "feedback_follow_up" || metaTemplateName === "feedback_request_template") {
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: salonName },
        { type: "text", text: "https://link.styluxe.in/STY0110Review" }
      ];
    }

    const components = parameters.length > 0 ? [{ type: "body", parameters }] : [];

    return await sendMetaWhatsAppMessage({
      salonId,
      branchId,
      to,
      templateName: metaTemplateName,
      components,
      languageCode: "en"
    });
  } catch (err) {
    console.error("[dispatchWhatsAppTemplate] Error:", err.message);
    return null;
  }
}
