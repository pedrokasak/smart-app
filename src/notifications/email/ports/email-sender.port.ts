export type EmailMessage = {
	to: string;
	subject: string;
	html: string;
	text?: string;
	from?: string;
	replyTo?: string;
	attachments?: { filename: string; content: Buffer }[];
};

export interface EmailSender {
	send(message: EmailMessage): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
