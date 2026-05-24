import * as React from "react";
import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";

type LeadField = {
  label: string;
  value: string;
};

function safeString(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "-";
  }
  return JSON.stringify(value);
}

function flattenLeadData(data: Record<string, unknown>): LeadField[] {
  const skipKeys = new Set(["recipientEmail", "tenant", "source", "submittedAt", "email_confirm"]);
  return Object.entries(data)
    .filter(([key]) => !key.startsWith("_") && !skipKeys.has(key))
    .slice(0, 12)
    .map(([key, value]) => ({ label: key, value: safeString(value) }));
}

function LeadSenderConfirmationEmail(props: {
  tenantName: string;
  correlationId: string;
  leadData: Record<string, unknown>;
}) {
  const fields = flattenLeadData(props.leadData);

  return (
    <Html>
      <Head />
      <Preview>Conferma invio richiesta - {props.tenantName}</Preview>
      <Body style={{ backgroundColor: "#f5f7fb", color: "#1d2433", fontFamily: "Inter, Arial, sans-serif", padding: "24px" }}>
        <Container style={{ backgroundColor: "#ffffff", border: "1px solid #dbe3ef", borderRadius: "12px", padding: "24px" }}>
          <Section>
            <Link href="https://app.jsonpages.io" style={{ color: "#111827", textDecoration: "none", fontSize: "18px", fontWeight: 700 }}>
              JsonPages
            </Link>
            <Text style={{ color: "#5f6c81", marginTop: "6px", marginBottom: "0" }}>Conferma automatica di ricezione</Text>
          </Section>

          <Hr style={{ borderColor: "#e5ebf5", margin: "20px 0" }} />

          <Heading as="h2" style={{ color: "#111827", margin: "0 0 12px 0", fontSize: "22px" }}>
            Richiesta ricevuta
          </Heading>
          <Text style={{ color: "#4b5563", marginTop: "0", marginBottom: "16px" }}>
            Grazie, abbiamo ricevuto la tua richiesta per {props.tenantName}. Ti risponderemo il prima possibile.
          </Text>

          <Section style={{ border: "1px solid #e5ebf5", borderRadius: "10px", padding: "12px" }}>
            <Text style={{ margin: "0 0 8px 0", color: "#111827", fontWeight: 600 }}>Riepilogo inviato</Text>
            {fields.length === 0 ? (
              <Text style={{ color: "#4b5563", margin: 0 }}>Nessun dettaglio disponibile.</Text>
            ) : (
              fields.map((field) => (
                <Text key={field.label} style={{ margin: "0 0 8px 0", color: "#1f2937", fontSize: "14px", wordBreak: "break-word" }}>
                  <strong>{field.label}:</strong> {field.value}
                </Text>
              ))
            )}
          </Section>

          <Hr style={{ borderColor: "#e5ebf5", margin: "20px 0 12px 0" }} />
          <Text style={{ color: "#6b7280", fontSize: "12px", margin: 0 }}>Riferimento richiesta: {props.correlationId}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function renderLeadSenderConfirmationEmail(params: {
  tenantName: string;
  correlationId: string;
  leadData: Record<string, unknown>;
}): Promise<string> {
  return render(
    <LeadSenderConfirmationEmail
      tenantName={params.tenantName}
      correlationId={params.correlationId}
      leadData={params.leadData}
    />
  );
}
