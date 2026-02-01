export class UserResponseDto {
	id: string;
	email: string;
	firstName?: string;
	lastName?: string;
	avatar?: string;
	isEmailVerified: boolean;
	isActive: boolean;
	userSubscription?: string;
	lastLogin?: Date;
	createdAt: Date;
	updatedAt: Date;
}
