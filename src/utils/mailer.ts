import * as nodemailer from 'nodemailer';

// Em um ambiente de produção real, isso usaria variáveis de ambiente reais.
// No momento, se não configuradas, usaremos um comportamento mock/log.
const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST || 'smtp.ethereal.email',
	port: parseInt(process.env.SMTP_PORT) || 587,
	auth: {
		user: process.env.SMTP_USER || 'ethereal.user@ethereal.email',
		pass: process.env.SMTP_PASS || 'ethereal_password',
	},
});

export const sendPasswordResetEmail = async (email: string, token: string) => {
	const resetLink = `${process.env.URL_DEVELOPMENT || 'http://localhost:8080'}/reset-password?token=${token}`;

	const mailOptions = {
		from: '"Trakker Support" <noreply@trakker.app>',
		to: email,
		subject: 'Redefinição de Senha - Trakker',
		html: `
			<h1>Recuperação de Senha</h1>
			<p>Você solicitou a redefinição da sua senha. Clique no link abaixo para prosseguir:</p>
			<a href="${resetLink}">Redefinir minha senha</a>
			<p>Este link expira em 1 hora.</p>
			<p>Se você não solicitou isso, por favor ignore este email.</p>
		`,
	};

	try {
		if (!process.env.SMTP_HOST) {
			console.log('--- EMAIL MOCK ---');
			console.log('Destino:', email);
			console.log('Assunto:', mailOptions.subject);
			console.log('Link:', resetLink);
			console.log('------------------');
			return true;
		}

		const info = await transporter.sendMail(mailOptions);
		console.log('Email sent: %s', info.messageId);
		return true;
	} catch (error) {
		console.error('Error sending email:', error);
		return false;
	}
};
