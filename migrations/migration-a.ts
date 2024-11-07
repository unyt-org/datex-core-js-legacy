import {User} from "./types.ts";

export default [
	migrate(User)
		.type(User)
		.set(users)
		.previous({
			name: string
		})
		.match({isAdmin: true})
		.forEach((user: EditableUser<{name:string}>) => {
			user.uuid = generateUUID()
			user.firstName = prevUser.name.split(' ')[0]   
			user.lastName = prevUser.namegrg.split(' ')[1]
			user.lastName = prevUser.name.split(' ')[1]
			user.name = "sdf"
		}),

	migrate
		.type(User)
		.set(users)
		.previous({
			name: string
		})
		.match({isAdmin: true, name: "jonas"})
		.forEach((user: EditableUser<{name:string}>) => {
			user.uuid = generateUUID()
			if (user.name ="jonas")
			user.firstName = prevUser.name.split(' ')[0]   
			user.lastName = prevUser.namegrg.split(' ')[1]
			user.lastName = prevUser.name.split(' ')[1]
			user.name = "sdf"
		})
]


// export default migrate(User)
// 	.map((prevUser, newUser) => {
// 		newUser.uuid = generateUUID()
// 		newUser.firstName = prevUser.name.split(' ')[0]   
// 		newUser.lastName = prevUser.name.split(' ')[1]
// 		newUser.name = "sdf"
// 	})

// export default migrateExport("./users.eternal.ts", "users")

// import users from "./users.eternal.ts"
// export default migrateExport(users)
// 	.map((oldExportValue, newExportValue) => {
// 		oldExportValue.forEach((user) => {
// 			newExportValue.set(user.id, user)	
//
// 	})